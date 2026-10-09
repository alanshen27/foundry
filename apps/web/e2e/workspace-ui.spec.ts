import { expect, test } from "@playwright/test";

// Catch high-DPI drawing buffers accidentally becoming the canvas's CSS dimensions.
test.use({ deviceScaleFactor: 2 });

test("workspace keeps the model dominant and preserves assembly-to-part navigation", async ({
  page,
}, testInfo) => {
  // A cold dev server compiles the workspace, CAD and PCB surfaces on first visit.
  test.setTimeout(180_000);
  const errors: string[] = [];
  const serviceCalls: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || !["localhost", "127.0.0.1"].includes(url.hostname)) {
      serviceCalls.push(request.url());
    }
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/dev/workspace-ui-lab");
  await expect(page.getByText("LOCAL / UNVERIFIED", { exact: true })).toBeVisible();
  const viewport = page.locator('[data-cad-renderer="three"]:visible');
  await expect(viewport).toHaveAttribute("data-cad-status", "running", { timeout: 60_000 });
  await expect(viewport).toHaveAttribute("data-cad-engine", "build123d");
  const canvas = viewport.locator("canvas");
  const viewportBox = (await viewport.boundingBox())!;
  await expect
    .poll(async () => (await canvas.boundingBox())!.width)
    .toBeCloseTo(viewportBox.width, 0);
  await expect
    .poll(async () => (await canvas.boundingBox())!.height)
    .toBeCloseTo(viewportBox.height, 0);
  const chat = page.getByRole("complementary", { name: "AI copilot" });
  await expect(chat).toBeVisible();
  expect((await chat.boundingBox())!.width).toBeLessThan(480);
  expect((await viewport.boundingBox())!.width).toBeGreaterThan(900);
  const openDocuments = page.getByRole("navigation", { name: "Open documents" });
  await expect(openDocuments.getByRole("button", { name: /^Assembly$/i })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.screenshot({ path: testInfo.outputPath("workspace-desktop.png") });

  const beforeHide = (await viewport.boundingBox())!.width;
  await page.getByRole("button", { name: "Hide copilot", exact: true }).click();
  await expect(chat).toHaveCount(0);
  expect((await viewport.boundingBox())!.width).toBeGreaterThan(beforeHide + 250);
  await expect
    .poll(async () =>
      Math.abs((await canvas.boundingBox())!.width - (await viewport.boundingBox())!.width),
    )
    .toBeLessThan(1);
  await page.getByRole("button", { name: "Show copilot", exact: true }).click();
  await expect(chat).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs((await canvas.boundingBox())!.width - (await viewport.boundingBox())!.width),
    )
    .toBeLessThan(1);

  const structure = page.getByRole("complementary", { name: "Assembly components" });
  await structure.getByRole("button", { name: /^Upper housing PART$/i }).click();
  await structure.getByRole("button", { name: /^Open part$/i }).click();
  await expect(openDocuments.getByRole("button", { name: /^Upper housing$/i })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page).toHaveURL(/view=model&part=top/);
  await expect(viewport).toHaveAttribute("data-cad-status", "running", { timeout: 60_000 });
  await expect(viewport).toHaveAttribute("data-cad-engine", "build123d");
  await expect(
    page.getByText("parts/top/main.py", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Measure$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Move \/ Copy$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show code", exact: true })).toBeVisible();
  await page.getByText(/^Export$/i).click();
  await expect(page.getByRole("button", { name: /^Export STEP$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Export STL$/i })).toBeVisible();
  await page.getByText(/^Export$/i).click();
  await page.screenshot({ path: testInfo.outputPath("workspace-cad-part.png") });
  await expect(openDocuments.getByRole("button", { name: /^Assembly$/i })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await openDocuments.getByRole("button", { name: "Close Upper housing", exact: true }).click();
  await expect(openDocuments.getByRole("button", { name: /^Assembly$/i })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(errors).toEqual([]);
  expect(serviceCalls).toEqual([]);
});

test("compact workspace can dismiss the copilot and review checks without page overflow", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto("/dev/workspace-ui-lab");
  const viewport = page.locator('[data-cad-renderer="three"]:visible');
  await expect(viewport).toHaveAttribute("data-cad-status", "running", { timeout: 60_000 });
  await page.getByRole("button", { name: "Hide copilot", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "AI copilot" })).toHaveCount(0);
  expect((await viewport.boundingBox())!.width).toBeGreaterThan(650);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
  await page.screenshot({ path: testInfo.outputPath("workspace-compact.png") });
  await page.getByRole("button", { name: "Open window", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Checks$/i }).click();
  await expect(page.getByText(/^PCB clearance and connector access$/i)).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Open documents" })
      .getByRole("button", { name: /^Checks$/i }),
  ).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: testInfo.outputPath("workspace-checks.png") });
});
