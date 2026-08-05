import { beforeEach, describe, expect, it, vi } from "vitest";

// render.ts is a server module; neither guard matters under vitest.
vi.mock("server-only", () => ({}));

const launch = vi.fn();
vi.mock("playwright-core", () => ({ chromium: { launch: () => launch() } }));

/** Fresh module registry per test so the cached browser promise resets. */
async function loadRender() {
  vi.resetModules();
  return import("@/server/ai/render");
}

const MISSING_EXECUTABLE =
  "browserType.launch: Executable doesn't exist at " +
  "/opt/render/.cache/ms-playwright/chromium_headless_shell-1228/" +
  "chrome-headless-shell-linux64/chrome-headless-shell";

describe("screenshotRenderPage browser launch", () => {
  beforeEach(() => {
    launch.mockReset();
  });

  it("hides deployment paths when the renderer is unavailable", async () => {
    const { screenshotRenderPage } = await loadRender();
    launch.mockRejectedValue(new Error(MISSING_EXECUTABLE));

    await expect(
      screenshotRenderPage("http://localhost/render/cad", { width: 800, height: 600 }),
    ).rejects.toThrow(/rendering service is unavailable/i);
  });

  it("hides runtime details for other launch failures", async () => {
    const { screenshotRenderPage } = await loadRender();
    launch.mockRejectedValue(new Error("Target page, context or browser has been closed"));

    await expect(
      screenshotRenderPage("http://localhost/render/cad", { width: 800, height: 600 }),
    ).rejects.toThrow("The rendering service could not start. Try again shortly.");
  });

  it("rewrites the missing-binary error for extract_product_images too", async () => {
    const { extractProductImages } = await loadRender();
    launch.mockRejectedValue(new Error(MISSING_EXECUTABLE));

    await expect(extractProductImages("https://example.com/part")).rejects.toThrow(
      /rendering service is unavailable/i,
    );
  });
});

const OG_PAGE = `<meta property="og:image" content="https://cdn.example.com/part.jpg">`;

/** Launches a Chromium that OOM-died before we got to use it, then a live one. */
function deadThenLiveBrowser(page: unknown) {
  let dead = true;
  return async () => {
    const wasDead = dead;
    dead = false;
    return {
      on: () => undefined,
      isConnected: () => true,
      close: async () => undefined,
      newPage: async () => {
        if (wasDead) throw new Error("Target page, context or browser has been closed");
        return page;
      },
    };
  };
}

describe("extract_product_images resilience", () => {
  beforeEach(() => {
    launch.mockReset();
    vi.unstubAllGlobals();
  });

  it("relaunches when the cached browser died, instead of failing the job", async () => {
    const { extractProductImages } = await loadRender();
    const page = {
      goto: async () => undefined,
      content: async () => OG_PAGE,
      evaluate: async () => [
        { url: "https://cdn.example.com/part.jpg", source: "og", width: 0, height: 0 },
      ],
      close: async () => undefined,
    };
    launch.mockImplementation(deadThenLiveBrowser(page));

    const result = await extractProductImages("https://example.com/part");
    expect(result.via).toBe("browser");
    expect(result.images[0]?.url).toBe("https://cdn.example.com/part.jpg");
  });

  it("falls back to plain HTML when the browser cannot start at all", async () => {
    const { extractProductImages } = await loadRender();
    launch.mockRejectedValue(new Error("spawn ENOMEM"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(OG_PAGE, { status: 200 })),
    );

    const result = await extractProductImages("https://example.com/part");
    expect(result.via).toBe("html");
    expect(result.images[0]?.url).toBe("https://cdn.example.com/part.jpg");
    expect(result.problem).toBeUndefined();
  });

  it("reports an anti-bot page as blocked rather than as a failure", async () => {
    const { extractProductImages } = await loadRender();
    const challenge = `<title>Just a moment...</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>`;
    const page = {
      goto: async () => undefined,
      content: async () => challenge,
      evaluate: async () => {
        throw new Error("harvest should not run on a challenge page");
      },
      close: async () => undefined,
    };
    launch.mockImplementation(async () => ({
      on: () => undefined,
      isConnected: () => true,
      close: async () => undefined,
      newPage: async () => page,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(challenge, { status: 403 })),
    );

    const result = await extractProductImages("https://www.digikey.com/en/products/detail/x");
    expect(result.images).toEqual([]);
    expect(result.problem).toBe("blocked");
  });
});
