import { describe, expect, it } from "vitest";
import { productImagesFromHtml } from "@/server/ai/product-image-metadata";
import {
  createPublicPageLoader,
  isPublicPageAddress,
  publicPageUrl,
} from "@/server/ai/public-page";

describe("fast product-image metadata", () => {
  it("extracts and ranks real metadata without browser hydration", () => {
    const images = productImagesFromHtml(
      `<html><head>
      <meta content='/photo.jpg?a=1&amp;b=2' property='og:image'>
      <meta name="twitter:image" content="/social.jpg">
      <script type="application/ld+json">{"@graph":[{"@type":"Product","image":["/photo.jpg?a=1&b=2",{"url":"/side.jpg"}]}]}</script>
      </head><body><img width="400" height="300" data-src="/detail.jpg"><img width="24" height="24" src="/icon.jpg"></body></html>`,
      "https://example.com/product/item",
    );
    expect(images.map((image) => [image.source, image.url])).toEqual([
      ["og", "https://example.com/photo.jpg?a=1&b=2"],
      ["twitter", "https://example.com/social.jpg"],
      ["jsonld", "https://example.com/side.jpg"],
      ["img", "https://example.com/detail.jpg"],
    ]);
  });
  it("ignores pseudo-tags, malformed metadata and private image URLs", () => {
    expect(
      productImagesFromHtml(
        `<!-- <meta property="og:image" content="/comment.jpg"> -->
      <script>let html='<meta property="og:image" content="/fake.jpg">';</script>
      <script type="application/ld+json">not json</script>
      <meta property="og:image" content="http://127.0.0.1/private">
      <meta name="twitter:image" content="data:image/png,abc">`,
        "https://example.com/p",
      ),
    ).toEqual([]);
  });
});

describe("public product-page targets", () => {
  it("rejects loopback, private, link-local, mapped, multicast, and nonweb targets", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "172.31.2.3",
      "192.168.2.3",
      "100.64.1.1",
      "0.0.0.0",
      "224.1.2.3",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
    ])
      expect(isPublicPageAddress(address), address).toBe(false);
    for (const url of [
      "file:///etc/passwd",
      "http://localhost/a",
      "http://a.local/",
      "http://user:pass@example.com",
      "http://example.com:8080/",
      "http://2130706433/",
      "http://[::1]/",
    ])
      expect(() => publicPageUrl(url), url).toThrow();
    expect(isPublicPageAddress("93.184.216.34")).toBe(true);
    expect(isPublicPageAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("requires every DNS address to be public and cancels pending resolution", async () => {
    const signal = new AbortController();
    const mixed = createPublicPageLoader(signal.signal, async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(mixed.validate("https://example.com")).rejects.toThrow("public addresses");
    const pending = createPublicPageLoader(signal.signal, () => new Promise(() => {})).validate(
      "https://example.com",
    );
    signal.abort();
    await expect(pending).rejects.toThrow("cancelled");
  });
});
