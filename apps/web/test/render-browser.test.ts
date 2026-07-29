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

  it("explains a missing Chromium instead of telling the dyno to run an installer", async () => {
    const { screenshotRenderPage } = await loadRender();
    launch.mockRejectedValue(new Error(MISSING_EXECUTABLE));

    await expect(
      screenshotRenderPage("http://localhost/render/cad", { width: 800, height: 600 }),
    ).rejects.toThrow(/Chromium is not installed in this deployment/);
  });

  it("keeps the original error for failures that are not a missing binary", async () => {
    const { screenshotRenderPage } = await loadRender();
    launch.mockRejectedValue(new Error("Target page, context or browser has been closed"));

    await expect(
      screenshotRenderPage("http://localhost/render/cad", { width: 800, height: 600 }),
    ).rejects.toThrow(/browser has been closed/);
  });

  it("rewrites the missing-binary error for extract_product_images too", async () => {
    const { extractProductImages } = await loadRender();
    launch.mockRejectedValue(new Error(MISSING_EXECUTABLE));

    await expect(extractProductImages("https://example.com/part")).rejects.toThrow(
      /Chromium is not installed in this deployment/,
    );
  });
});
