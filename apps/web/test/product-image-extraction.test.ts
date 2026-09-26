import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as PublicPage from "@/server/ai/public-page";

const mocks = vi.hoisted(() => ({ read: vi.fn(), validate: vi.fn(), launch: vi.fn() }));
vi.mock("playwright-core", () => ({ chromium: { launch: mocks.launch } }));
vi.mock("@/server/ai/public-page", async (importOriginal) => ({
  ...(await importOriginal<typeof PublicPage>()),
  createPublicPageLoader: () => ({ read: mocks.read, validate: mocks.validate }),
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.validate.mockImplementation(async (url: string) => new URL(url));
});

describe("product-image extraction performance", () => {
  it("returns metadata without launching Chromium and caches subsequent limits", async () => {
    mocks.read.mockResolvedValue({
      url: "https://example.com/p",
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from(
        '<meta property="og:image" content="/front.jpg"><meta name="twitter:image" content="/back.jpg">',
      ),
    });
    const { extractProductImages } = await import("@/server/ai/render");
    const result = await extractProductImages("https://example.com/p", { limit: 1 });
    expect(result.images).toHaveLength(1);
    expect(result.via).toBe("html");
    expect(result.images[0]!.url).toBe("https://example.com/front.jpg");
    expect((await extractProductImages("https://example.com/p", { limit: 2 })).images).toHaveLength(
      2,
    );
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.launch).not.toHaveBeenCalled();
  });
  it("uses rendered DOM for JavaScript-only pages and closes its browser", async () => {
    mocks.read.mockResolvedValue({
      url: "https://example.com/js",
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from('<div id="app"></div>'),
    });
    const result = [
      { url: "https://example.com/rendered.jpg", source: "img", width: 500, height: 400 },
    ];
    const page = {
      route: vi.fn(),
      routeWebSocket: vi.fn(),
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValueOnce([]).mockResolvedValue(result),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const context = {
      route: page.route,
      routeWebSocket: page.routeWebSocket,
      on: vi.fn(),
      addInitScript: vi.fn(),
    };
    Object.assign(page, { context: () => context });
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    mocks.launch.mockResolvedValue(browser);
    const { extractProductImages } = await import("@/server/ai/render");
    expect(await extractProductImages("https://example.com/js")).toMatchObject({
      via: "browser",
      images: result,
    });
    expect(page.waitForFunction).toHaveBeenCalledOnce();
    expect(page.route).toHaveBeenCalledOnce();
    expect(page.routeWebSocket).toHaveBeenCalledOnce();
    expect(page.close).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(browser.close).toHaveBeenCalledOnce();
  });
  it("does no browser or network work for an already-cancelled lookup", async () => {
    const { extractProductImages } = await import("@/server/ai/render");
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractProductImages("https://example.com/p", { signal: controller.signal }),
    ).rejects.toThrow();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });
});
