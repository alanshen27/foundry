/**
 * Product-photo harvesting that does not depend on a browser.
 *
 * The headless browser is the better reader — it resolves lazy-loaded gallery
 * images — but it is also the part that fails: Chromium is single-process on a
 * 512MB dyno and distributors like DigiKey answer robots with a Cloudflare
 * interstitial. Both failures used to surface as "Image extraction failed" and
 * zero images. Most distributors put the product photo in `og:image`, so plain
 * HTML answers the question in those cases without Chromium at all.
 */

export type ProductImageCandidate = {
  url: string;
  source: "og" | "twitter" | "jsonld" | "img";
  width: number;
  height: number;
};

export type RawImageCandidate = { url: string; source: string; width: number; height: number };

/** Why a page yielded nothing, when it yielded nothing. */
export type ProductImageProblem = "blocked" | "browser-unavailable";

export type ProductImageResult = {
  images: ProductImageCandidate[];
  /** How the page was read; the browser is preferred, HTML is the fallback. */
  via: "browser" | "html";
  problem?: ProductImageProblem;
};

/** Best candidates first: richer sources win, then pixel area. */
export function rankCandidates(raw: RawImageCandidate[], limit: number): ProductImageCandidate[] {
  const seen = new Set<string>();
  return raw
    .filter((c) => {
      if (!c.url || seen.has(c.url)) return false;
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
}

/**
 * Anti-bot interstitials (Cloudflare Turnstile, Incapsula, PerimeterX) serve a
 * real 200 with no product on it. Their images are challenge branding, so
 * harvesting them would hand the copilot a shield logo as a component photo.
 */
export function looksLikeBotChallenge(html: string): boolean {
  return (
    /challenges\.cloudflare\.com|cf-browser-verification|cf_chl_opt|__cf_chl|_Incapsula_Resource|px-captcha|g-recaptcha/i.test(
      html,
    ) ||
    /<title[^>]*>[^<]*(just a moment|attention required|access denied|are you a robot|verify you are human)/i.test(
      html,
    )
  );
}

/** og/twitter/JSON-LD images parsed straight out of HTML, no browser needed. */
export function harvestImagesFromHtml(html: string, baseUrl: string): RawImageCandidate[] {
  const out: RawImageCandidate[] = [];
  const push = (url: string | undefined, source: string) => {
    if (!url) return;
    try {
      const abs = new URL(url, baseUrl).href;
      if (/^https?:/i.test(abs)) out.push({ url: abs, source, width: 0, height: 0 });
    } catch {
      // A malformed URL in someone else's markup is not worth failing over.
    }
  };

  const meta = (pattern: RegExp) => html.match(pattern)?.[1];
  push(
    meta(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i) ??
      meta(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i),
    "og",
  );
  push(meta(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i), "twitter");

  for (const block of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      const record = node as Record<string, unknown>;
      const image = record.image;
      if (typeof image === "string") push(image, "jsonld");
      else if (Array.isArray(image)) {
        for (const item of image) {
          if (typeof item === "string") push(item, "jsonld");
          else if (item && typeof item === "object" && "url" in item) {
            push(String((item as { url: unknown }).url), "jsonld");
          }
        }
      } else if (image && typeof image === "object" && "url" in image) {
        push(String((image as { url: unknown }).url), "jsonld");
      }
      if (record["@graph"]) visit(record["@graph"]);
    };
    try {
      visit(JSON.parse(block[1] ?? "null"));
    } catch {
      // Ignore malformed JSON-LD rather than losing the whole page.
    }
  }
  return out;
}

/** Reads the page over plain HTTP. Never throws; a failure means no images. */
export async function fetchProductImages(
  pageUrl: string,
): Promise<{ raw: RawImageCandidate[]; blocked: boolean }> {
  try {
    const response = await fetch(pageUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: {
        // Distributors serve a stub to obvious robots; ask as a browser would.
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      return { raw: [], blocked: response.status === 403 || response.status === 429 };
    }
    const html = await response.text();
    if (looksLikeBotChallenge(html)) return { raw: [], blocked: true };
    return { raw: harvestImagesFromHtml(html, response.url || pageUrl), blocked: false };
  } catch {
    return { raw: [], blocked: false };
  }
}
