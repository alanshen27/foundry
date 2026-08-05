import { describe, expect, it } from "vitest";
import {
  harvestImagesFromHtml,
  looksLikeBotChallenge,
  rankCandidates,
} from "@/server/ai/product-images";

const TURNSTILE = `<!DOCTYPE html><html><head><title>Just a moment...</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head>
<body><div class="cf-browser-verification"></div></body></html>`;

const PRODUCT = `<!DOCTYPE html><html><head>
<title>SCD41-D-R2 Sensirion</title>
<meta property="og:image" content="//media.digikey.com/photos/scd41.jpg" />
<meta name="twitter:image" content="https://cdn.example.com/twitter.png" />
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","image":{"url":"https://cdn.example.com/ld.jpg"}}
</script>
</head><body></body></html>`;

describe("looksLikeBotChallenge", () => {
  it("recognises a Cloudflare interstitial", () => {
    expect(looksLikeBotChallenge(TURNSTILE)).toBe(true);
  });

  it("does not cry wolf on a real product page", () => {
    expect(looksLikeBotChallenge(PRODUCT)).toBe(false);
  });
});

describe("harvestImagesFromHtml", () => {
  it("reads og, twitter and JSON-LD images and absolutises them", () => {
    const found = harvestImagesFromHtml(PRODUCT, "https://www.digikey.com/en/products/detail/x");
    expect(found.map((c) => c.url)).toEqual([
      "https://media.digikey.com/photos/scd41.jpg",
      "https://cdn.example.com/twitter.png",
      "https://cdn.example.com/ld.jpg",
    ]);
    expect(found[0]?.source).toBe("og");
  });

  it("survives malformed JSON-LD and junk URLs", () => {
    const html = `<meta property="og:image" content="javascript:alert(1)">
      <script type="application/ld+json">{ not json </script>`;
    expect(harvestImagesFromHtml(html, "https://example.com")).toEqual([]);
  });

  it("finds nothing in a challenge page", () => {
    expect(harvestImagesFromHtml(TURNSTILE, "https://example.com")).toEqual([]);
  });
});

describe("rankCandidates", () => {
  it("prefers a declared product image over page furniture, and dedupes", () => {
    const ranked = rankCandidates(
      [
        { url: "https://x/banner.jpg", source: "img", width: 400, height: 300 },
        { url: "https://x/og.jpg", source: "og", width: 0, height: 0 },
        { url: "https://x/banner.jpg", source: "img", width: 400, height: 300 },
      ],
      5,
    );
    expect(ranked.map((c) => c.url)).toEqual(["https://x/og.jpg", "https://x/banner.jpg"]);
  });
});
