import { describe, expect, it } from "vitest";
import { HARVEST_PRODUCT_IMAGES_SCRIPT } from "@/server/ai/render";

/**
 * The harvest script runs inside a Playwright page via `page.evaluate(string)`.
 * It must be self-contained JavaScript: no bundler runtime helpers (`__name`
 * and friends only exist in the server bundle) and no free identifiers beyond
 * browser globals.
 */
describe("HARVEST_PRODUCT_IMAGES_SCRIPT", () => {
  it("parses as a standalone expression", () => {
    expect(() => new Function(`return ${HARVEST_PRODUCT_IMAGES_SCRIPT}`)).not.toThrow();
  });

  it("references no bundler runtime helpers", () => {
    expect(HARVEST_PRODUCT_IMAGES_SCRIPT).not.toMatch(/__name|__async|__require|webpack/);
  });

  it("runs against a minimal DOM and collects og/twitter/img candidates", () => {
    const meta = (attr: string, name: string, content: string) => ({
      getAttribute: (key: string) => (key === "content" ? content : null),
      [attr]: name,
    });
    const img = {
      naturalWidth: 640,
      naturalHeight: 480,
      width: 640,
      height: 480,
      currentSrc: "https://cdn.example.com/part.jpg",
      src: "https://cdn.example.com/part.jpg",
    };
    const document = {
      querySelector: (sel: string) =>
        sel.includes("og:image")
          ? meta("property", "og:image", "https://example.com/og.png")
          : sel.includes("twitter:image")
            ? meta("name", "twitter:image", "/relative/twitter.png")
            : null,
      querySelectorAll: (sel: string) => (sel === "img" ? [img] : []),
    };
    const location = { href: "https://example.com/product" };
    const run = new Function("document", "location", `return ${HARVEST_PRODUCT_IMAGES_SCRIPT}`) as (
      doc: unknown,
      loc: unknown,
    ) => { url: string; source: string }[];

    const out = run(document, location);
    expect(out).toEqual([
      { url: "https://example.com/og.png", source: "og", width: 0, height: 0 },
      { url: "https://example.com/relative/twitter.png", source: "twitter", width: 0, height: 0 },
      { url: "https://cdn.example.com/part.jpg", source: "img", width: 640, height: 480 },
    ]);
  });
});
