import "server-only";
import { chromium, type Browser } from "playwright-core";
import {
  fetchProductImages,
  looksLikeBotChallenge,
  rankCandidates,
  type ProductImageResult,
  type RawImageCandidate,
} from "./product-images";
import { createPublicPageLoader, publicPageUrl, type PublicPageResponse } from "./public-page";
import { productImagesFromHtml, rankProductImages } from "./product-image-metadata";

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
      timeout: 10_000,
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

type BrowserPage = Awaited<ReturnType<Browser["newPage"]>>;

/**
 * Run one Playwright job under the global lock, then shut Chromium down if the
 * queue is idle so RSS returns to the Next.js baseline.
 */
async function withBrowserPage<T>(
  viewport: { width: number; height: number },
  fn: (page: BrowserPage) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  /**
   * A cached browser can be dead before we touch it: Chromium is single-process
   * on these dynos, so an OOM kill leaves a resolved promise pointing at a
   * corpse and newPage() fails with "…has been closed". Drop it and launch once
   * more rather than failing a job for the previous job's crash.
   */
  const newPage = async () => {
    signal?.throwIfAborted();
    const browser = await getBrowser();
    const opts = { viewport, deviceScaleFactor: 1 as const, serviceWorkers: "block" as const };
    if (typeof browser.isConnected === "function" && !browser.isConnected()) {
      await closeBrowser();
      return (await getBrowser()).newPage(opts);
    }
    try {
      return await browser.newPage(opts);
    } catch (err) {
      if (!isDeadBrowser(err)) throw err;
      await closeBrowser();
      return (await getBrowser()).newPage(opts);
    }
  };

  const run = async (): Promise<T> => {
    signal?.throwIfAborted();
    const page = await newPage();
    const cancel = () => {
      void page.close().catch(() => undefined);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      signal?.throwIfAborted();
      return await fn(page);
    } finally {
      signal?.removeEventListener("abort", cancel);
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
    if (!signal) return await job;
    return await new Promise<T>((resolve, reject) => {
      const cancel = () =>
        reject(
          new Error(
            signal.reason?.name === "TimeoutError" ? "Rendering timed out" : "Rendering cancelled",
          ),
        );
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      job.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
    });
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
    signal,
  }: {
    width: number;
    height: number;
    /**
     * How long to wait for the page to report a painted canvas. A cold geometry
     * connection plus KCL execution can take well over the default.
     */
    readyTimeout?: number;
    /** Fail instead of capturing a half-drawn viewport. */
    requireReady?: boolean;
    signal?: AbortSignal;
  },
): Promise<Buffer> {
  return withBrowserPage(
    { width, height },
    async (page) => {
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
    },
    signal,
  );
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

const imageCache = new Map<string, { expiresAt: number; result: ProductImageResult }>();
const IMAGE_CACHE_TTL_MS = 120_000;
const IMAGE_CACHE_SIZE = 64;

function cacheResult(key: string, result: ProductImageResult): ProductImageResult {
  while (imageCache.size >= IMAGE_CACHE_SIZE) imageCache.delete(imageCache.keys().next().value!);
  imageCache.set(key, {
    expiresAt: Date.now() + (result.images.length ? IMAGE_CACHE_TTL_MS : 15_000),
    result,
  });
  return result;
}

/**
 * Read public-page metadata first; launch Chromium only for pages whose images
 * require JavaScript. Fall back to plain HTML when the browser cannot start,
 * and honor queued cancellation.
 */
export async function extractProductImages(
  pageUrl: string,
  {
    limit = 8,
    signal,
    timeoutMs = 20_000,
  }: { limit?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ProductImageResult> {
  signal?.throwIfAborted();
  const key = publicPageUrl(pageUrl).href;
  const cached = imageCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.result,
      images: cached.result.images.slice(0, limit).map((image) => ({ ...image })),
    };
  }
  imageCache.delete(key);

  const deadline = AbortSignal.timeout(Math.max(1, Math.min(30_000, timeoutMs)));
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const loader = createPublicPageLoader(combined);

  let fetched: PublicPageResponse | undefined;
  let htmlImages: ProductImageResult | undefined;
  try {
    const metadataSignal = AbortSignal.any([combined, AbortSignal.timeout(6_000)]);
    fetched = await createPublicPageLoader(metadataSignal).read(key);
    if (
      fetched.status < 400 &&
      /html|xhtml/i.test(fetched.headers["content-type"] ?? "text/html")
    ) {
      const html = fetched.body.toString("utf8");
      if (looksLikeBotChallenge(html)) {
        htmlImages = { images: [], via: "html", problem: "blocked" };
      } else {
        const images = rankProductImages(productImagesFromHtml(html, fetched.url), 12);
        if (images.length) htmlImages = { images, via: "html" };
      }
    }
  } catch (error) {
    combined.throwIfAborted();
    if (error instanceof Error && /public (HTTP|addresses)/.test(error.message)) throw error;
  }

  if (htmlImages?.images.length) {
    cacheResult(key, htmlImages);
    return {
      ...htmlImages,
      images: htmlImages.images.slice(0, limit).map((image) => ({ ...image })),
    };
  }

  let browserFailure: unknown;
  let blockedInBrowser = htmlImages?.problem === "blocked";
  try {
    await loader.validate(key);
    const viaBrowser = await withBrowserPage(
      { width: 1280, height: 900 },
      async (page) => {
        const context =
          "context" in page && typeof page.context === "function" ? page.context() : null;
        if (context) {
          context.on?.("page", (popup: { close: () => Promise<void> }) => {
            if (popup !== page) void popup.close().catch(() => undefined);
          });
          await context.addInitScript?.(
            `for (const key of ['RTCPeerConnection','webkitRTCPeerConnection']) Object.defineProperty(globalThis,key,{value:undefined,writable:false,configurable:false});`,
          );
          await context.routeWebSocket?.("**/*", (socket: { close: () => void }) => socket.close());
          let bytes = 0;
          let requests = 0;
          let initial = fetched;
          let active = 0;
          const waiters: Array<() => void> = [];
          await context.route?.("**/*", async (route: {
            request: () => {
              method: () => string;
              resourceType: () => string;
              isNavigationRequest: () => boolean;
              url: () => string;
              headers: () => { accept?: string };
            };
            abort: () => Promise<void>;
            fulfill: (response: {
              status: number;
              headers: Record<string, string>;
              body: Buffer;
            }) => Promise<void>;
          }) => {
            const request = route.request();
            if (
              request.method() !== "GET" ||
              ["font", "media"].includes(request.resourceType()) ||
              ++requests > 80 ||
              bytes > 12_000_000
            ) {
              await route.abort();
              return;
            }
            if (active >= 4) await new Promise<void>((resolve) => waiters.push(resolve));
            active++;
            try {
              if (bytes > 12_000_000 || combined.aborted) {
                await route.abort();
                return;
              }
              let response: PublicPageResponse;
              if (initial && request.isNavigationRequest() && request.url() === initial.url) {
                response = initial;
                initial = undefined;
              } else
                response = await loader.read(request.url(), {
                  accept: request.headers().accept ?? "*/*",
                });
              bytes += response.body.length;
              await route.fulfill({
                status: response.status,
                headers: response.headers,
                body: response.body,
              });
            } catch {
              await route.abort().catch(() => undefined);
            } finally {
              active--;
              waiters.shift()?.();
            }
          });
        }

        await page.goto(fetched?.url ?? key, { waitUntil: "domcontentloaded", timeout: 12_000 });
        const html =
          "content" in page && typeof page.content === "function"
            ? await page.content().catch(() => "")
            : "";
        const blocked = looksLikeBotChallenge(html);
        let raw = blocked
          ? []
          : ((await page.evaluate(HARVEST_PRODUCT_IMAGES_SCRIPT)) as RawImageCandidate[]);
        if (!blocked && !raw.length && "waitForFunction" in page) {
          await page
            .waitForFunction(`() => (${HARVEST_PRODUCT_IMAGES_SCRIPT}).length > 0`, {}, {
              timeout: 2_500,
            })
            .catch(() => undefined);
          raw = (await page.evaluate(HARVEST_PRODUCT_IMAGES_SCRIPT)) as RawImageCandidate[];
        }
        return { raw, blocked };
      },
      combined,
    );
    if (viaBrowser.raw.length > 0) {
      const result: ProductImageResult = {
        images: rankCandidates(viaBrowser.raw, 12),
        via: "browser",
      };
      cacheResult(key, result);
      return { ...result, images: result.images.slice(0, limit).map((image) => ({ ...image })) };
    }
    blockedInBrowser = viaBrowser.blocked;
  } catch (err) {
    combined.throwIfAborted();
    if (/rendering service is unavailable/i.test(err instanceof Error ? err.message : ""))
      throw err;
    browserFailure = err;
  }

  const viaHtml = await fetchProductImages(pageUrl);
  if (viaHtml.raw.length > 0) {
    const result: ProductImageResult = { images: rankCandidates(viaHtml.raw, 12), via: "html" };
    cacheResult(key, result);
    return { ...result, images: result.images.slice(0, limit).map((image) => ({ ...image })) };
  }

  const blocked = blockedInBrowser || viaHtml.blocked;
  const result: ProductImageResult = {
    images: [],
    via: browserFailure ? "html" : "browser",
    ...(blocked
      ? { problem: "blocked" as const }
      : browserFailure
        ? { problem: "browser-unavailable" as const }
        : {}),
  };
  cacheResult(key, result);
  return result;
}
