import "server-only";
import { chromium, type Browser } from "playwright-core";

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

/**
 * Run one Playwright job under the global lock, then shut Chromium down if the
 * queue is idle so RSS returns to the Next.js baseline.
 */
async function withBrowserPage<T>(
  viewport: { width: number; height: number },
  fn: (page: Awaited<ReturnType<Browser["newPage"]>>) => Promise<T>,
): Promise<T> {
  const run = async (): Promise<T> => {
    const browser = await getBrowser();
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: 1,
    });
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

export type ProductImageCandidate = {
  url: string;
  source: "og" | "twitter" | "jsonld" | "img";
  width: number;
  height: number;
};

/**
 * Open a product page and harvest likely component photos (og/twitter/JSON-LD
 * + large &lt;img&gt; elements). Uses the rendered DOM so lazy-loaded images resolve.
 */
export async function extractProductImages(
  pageUrl: string,
  { limit = 8 }: { limit?: number } = {},
): Promise<ProductImageCandidate[]> {
  return withBrowserPage({ width: 1280, height: 900 }, async (page) => {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await new Promise((r) => setTimeout(r, 800));
    const raw = await page.evaluate(() => {
      const out: { url: string; source: string; width: number; height: number }[] = [];
      const push = (url: string | null | undefined, source: string, w = 0, h = 0) => {
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
      push(
        document.querySelector('meta[name="twitter:image"]')?.getAttribute("content"),
        "twitter",
      );
      for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const data = JSON.parse(script.textContent || "null") as unknown;
          const visit = (node: unknown) => {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) {
              node.forEach(visit);
              return;
            }
            const obj = node as Record<string, unknown>;
            const img = obj.image;
            if (typeof img === "string") push(img, "jsonld");
            else if (Array.isArray(img)) {
              for (const item of img) {
                if (typeof item === "string") push(item, "jsonld");
                else if (item && typeof item === "object" && "url" in item) {
                  push(String((item as { url: unknown }).url), "jsonld");
                }
              }
            } else if (img && typeof img === "object" && "url" in img) {
              push(String((img as { url: unknown }).url), "jsonld");
            }
            if (obj["@graph"]) visit(obj["@graph"]);
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
    });

    const seen = new Set<string>();
    return raw
      .filter((c) => {
        if (seen.has(c.url)) return false;
        seen.add(c.url);
        return true;
      })
      .map((c) => ({
        url: c.url,
        source: c.source as ProductImageCandidate["source"],
        width: c.width,
        height: c.height,
      }))
      .sort((a, b) => {
        const score = (c: ProductImageCandidate) => {
          const sourceScore =
            c.source === "og" ? 4 : c.source === "twitter" ? 3 : c.source === "jsonld" ? 2 : 1;
          return sourceScore * 1_000_000 + c.width * c.height;
        };
        return score(b) - score(a);
      })
      .slice(0, limit);
  });
}
