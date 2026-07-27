import "server-only";
import { chromium, type Browser } from "playwright-core";

/**
 * Headless-browser screenshots of the /render/* pages, so the copilot can see
 * the actual editors (3D model, circuit) and iterate on its own output.
 */

let browserPromise: Promise<Browser> | null = null;

/**
 * Belt-and-braces for the dev-tools badge: the dev runtime injects it outside
 * our layouts, so it also shows up on error and 404 pages that never reach
 * `app/render/layout.tsx`.
 */
const HIDE_DEV_OVERLAY_CSS = `
  nextjs-portal { display: none !important; }
  html, body { overflow: hidden !important; }
`;

async function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ headless: true }).then((browser) => {
    browser.on("disconnected", () => {
      browserPromise = null;
    });
    return browser;
  });
  return browserPromise;
}

export async function screenshotRenderPage(
  url: string,
  { width, height }: { width: number; height: number },
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    // Render pages set data-render-ready once canvases have painted.
    await page
      .waitForSelector("body[data-render-ready='1']", { timeout: 15_000 })
      .catch(() => undefined);
    await page.addStyleTag({ content: HIDE_DEV_OVERLAY_CSS }).catch(() => undefined);
    return await page.screenshot({ type: "png" });
  } finally {
    await page.close();
  }
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
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  try {
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
      push(
        document.querySelector('meta[property="og:image"]')?.getAttribute("content"),
        "og",
      );
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
    const ranked = raw
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

    return ranked;
  } finally {
    await page.close();
  }
}
