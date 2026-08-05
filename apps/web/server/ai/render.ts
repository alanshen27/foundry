import "server-only";
import { chromium, type Browser } from "playwright-core";
import {
  fetchProductImages,
  looksLikeBotChallenge,
  rankCandidates,
  type ProductImageResult,
  type RawImageCandidate,
} from "./product-images";

export type { ProductImageCandidate, ProductImageResult } from "./product-images";

/**
 * Headless-browser screenshots of the /render/* pages, so the copilot can see
 * the actual editors (3D model, circuit) and iterate on its own output.
 *
 * IMPORTANT: Render Starter is 512MB. A long-lived Chromium singleton will OOM
 * the web dyno (and the chat worker). We serialize captures and always close
 * the browser when the queue drains.
 */

let browserPromise: Promise<Browser> | null = null;
/** Tail of the capture queue — only one Chromium job at a time. */
let queueTail: Promise<unknown> = Promise.resolve();

/**
 * Belt-and-braces for the dev-tools badge: the dev runtime injects it outside
 * our layouts, so it also shows up on error and 404 pages that never reach
 * `app/render/layout.tsx`.
 */
const HIDE_DEV_OVERLAY_CSS = `
  nextjs-portal { display: none !important; }
  html, body { overflow: hidden !important; }
`;

/**
 * Convert launch failures to public-safe messages. Raw Playwright errors can
 * include absolute deployment paths, command lines, and host details.
 */
function describeLaunchFailure(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/Executable doesn't exist/i.test(message)) {
    return new Error(
      "The rendering service is unavailable in this deployment. Contact a workspace administrator.",
    );
  }
  return new Error("The rendering service could not start. Try again shortly.");
}

async function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium
    .launch({
      headless: true,
      args: [
        // Keep the footprint tiny on 512MB dynos.
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-gpu",
        "--single-process",
      ],
    })
    .then(
      (browser) => {
        browser.on("disconnected", () => {
          browserPromise = null;
        });
        return browser;
      },
      (err: unknown) => {
        // Belt-and-braces: withBrowserPage's closeBrowser() already clears the
        // slot once the job settles. `disconnected` never fires for a browser
        // that failed to start, so clear it here too and keep getBrowser()
        // retryable on its own terms.
        browserPromise = null;
        throw describeLaunchFailure(err);
      },
    );
  return browserPromise;
}

async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // ignore — process may already be dead after OOM/restart
  }
}

/** A browser that died since we cached it, e.g. an OOM kill on a 512MB dyno. */
const isDeadBrowser = (err: unknown) =>
  /Target page, context or browser has been closed|Browser has been closed|browser has disconnected/i.test(
    err instanceof Error ? err.message : String(err),
  );

/**
 * Run one Playwright job under the global lock, then shut Chromium down if the
 * queue is idle so RSS returns to the Next.js baseline.
 */
async function withBrowserPage<T>(
  viewport: { width: number; height: number },
  fn: (page: Awaited<ReturnType<Browser["newPage"]>>) => Promise<T>,
): Promise<T> {
  /**
   * A cached browser can be dead before we touch it: Chromium is single-process
   * on these dynos, so an OOM kill leaves a resolved promise pointing at a
   * corpse and newPage() fails with "…has been closed". Drop it and launch once
   * more rather than failing a job for the previous job's crash.
   */
  const newPage = async () => {
    const browser = await getBrowser();
    if (!browser.isConnected()) {
      await closeBrowser();
      return (await getBrowser()).newPage({ viewport, deviceScaleFactor: 1 });
    }
    try {
      return await browser.newPage({ viewport, deviceScaleFactor: 1 });
    } catch (err) {
      if (!isDeadBrowser(err)) throw err;
      await closeBrowser();
      return (await getBrowser()).newPage({ viewport, deviceScaleFactor: 1 });
    }
  };

  const run = async (): Promise<T> => {
    const page = await newPage();
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  };

  const job = queueTail.then(run, run);
  // Keep the chain alive even if this job rejects.
  queueTail = job.then(
    () => undefined,
    () => undefined,
  );

  try {
    return await job;
  } finally {
    // If nothing else queued while we ran, release Chromium memory.
    const idle = queueTail;
    void idle.then(async () => {
      // Only close if we are still the idle tail (no newer job linked).
      if (queueTail === idle) await closeBrowser();
    });
  }
}

export async function screenshotRenderPage(
  url: string,
  {
    width,
    height,
    readyTimeout = 15_000,
    requireReady = false,
  }: {
    width: number;
    height: number;
    /**
     * How long to wait for the page to report a painted canvas. A cold Zoo
     * connection plus KCL execution can take well over the default.
     */
    readyTimeout?: number;
    /** Fail instead of capturing a half-drawn viewport. */
    requireReady?: boolean;
  },
): Promise<Buffer> {
  return withBrowserPage({ width, height }, async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    // Render pages set data-render-ready once canvases have painted.
    const ready = await page
      .waitForSelector("body[data-render-ready='1']", { timeout: readyTimeout })
      .then(() => true)
      .catch(() => false);
    if (!ready && requireReady) {
      throw new Error(`Viewport did not finish drawing within ${readyTimeout}ms`);
    }
    await page.addStyleTag({ content: HIDE_DEV_OVERLAY_CSS }).catch(() => undefined);
    return await page.screenshot({ type: "png" });
  });
}

/**
 * Image-harvest script, kept as a source string on purpose.
 *
 * `page.evaluate(fn)` serializes the function's *compiled* source and evals it
 * inside the page. Next's compiler wraps nested functions in a `__name(...)`
 * helper that only exists in the server bundle, so a compiled closure throws
 * `ReferenceError: __name is not defined` in the browser. A string bypasses
 * compilation entirely — nothing the bundler emits can leak into the page.
 */
export const HARVEST_PRODUCT_IMAGES_SCRIPT = `(() => {
  const out = [];
  const push = (url, source, w = 0, h = 0) => {
    if (!url) return;
    try {
      const abs = new URL(url, location.href).href;
      if (!/^https?:/i.test(abs)) return;
      out.push({ url: abs, source, width: w, height: h });
    } catch {
      /* ignore bad urls */
    }
  };
  push(document.querySelector('meta[property="og:image"]')?.getAttribute("content"), "og");
  push(document.querySelector('meta[name="twitter:image"]')?.getAttribute("content"), "twitter");
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent || "null");
      const visit = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        const img = node.image;
        if (typeof img === "string") push(img, "jsonld");
        else if (Array.isArray(img)) {
          for (const item of img) {
            if (typeof item === "string") push(item, "jsonld");
            else if (item && typeof item === "object" && "url" in item) {
              push(String(item.url), "jsonld");
            }
          }
        } else if (img && typeof img === "object" && "url" in img) {
          push(String(img.url), "jsonld");
        }
        if (node["@graph"]) visit(node["@graph"]);
      };
      visit(data);
    } catch {
      /* ignore bad json-ld */
    }
  }
  for (const img of document.querySelectorAll("img")) {
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if (w < 120 || h < 120) continue;
    push(img.currentSrc || img.src, "img", w, h);
  }
  return out;
})()`;

/**
 * Open a product page and harvest likely component photos (og/twitter/JSON-LD
 * + large &lt;img&gt; elements). The rendered DOM is the better reader, so it goes
 * first; plain HTML answers whenever the browser cannot (an anti-bot
 * interstitial, or Chromium dying on a small dyno) rather than reporting the
 * page as a failure.
 */
export async function extractProductImages(
  pageUrl: string,
  { limit = 8 }: { limit?: number } = {},
): Promise<ProductImageResult> {
  let browserFailure: unknown;
  let blockedInBrowser = false;

  try {
    const viaBrowser = await withBrowserPage({ width: 1280, height: 900 }, async (page) => {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await new Promise((r) => setTimeout(r, 800));
      const blocked = looksLikeBotChallenge(await page.content().catch(() => ""));
      const raw = blocked
        ? []
        : ((await page.evaluate(HARVEST_PRODUCT_IMAGES_SCRIPT)) as RawImageCandidate[]);
      return { raw, blocked };
    });
    if (viaBrowser.raw.length > 0) {
      return { images: rankCandidates(viaBrowser.raw, limit), via: "browser" };
    }
    blockedInBrowser = viaBrowser.blocked;
  } catch (err) {
    // A missing binary is a deployment fact the operator must see, not a page
    // problem to paper over with a fetch.
    if (/rendering service is unavailable/i.test(err instanceof Error ? err.message : ""))
      throw err;
    browserFailure = err;
  }

  const viaHtml = await fetchProductImages(pageUrl);
  if (viaHtml.raw.length > 0) return { images: rankCandidates(viaHtml.raw, limit), via: "html" };

  const blocked = blockedInBrowser || viaHtml.blocked;
  return {
    images: [],
    via: browserFailure ? "html" : "browser",
    ...(blocked
      ? { problem: "blocked" as const }
      : browserFailure
        ? { problem: "browser-unavailable" as const }
        : {}),
  };
}
