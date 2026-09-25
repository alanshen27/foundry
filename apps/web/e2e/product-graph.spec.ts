import { expect, test, type Page } from "@playwright/test";

/**
 * The product graph's central claim, end to end: change a part, and the
 * consequences show up where the work is.
 *
 * Runs against the seeded Environmental Monitor (pnpm db:seed). No model call
 * anywhere in the loop — the graph is derived from seeded data, which is the
 * whole reason the seed exists.
 */

const PROJECT = "/w/demo-workspace/projects/environmental-monitor/engineer";

async function signIn(page: Page) {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill("builder@foundry.local");
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/w\/[^/]+$/);
}

test("swapping the battery surfaces what depends on it, across tabs", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);

  await page.goto(`${PROJECT}?view=sourcing`);
  await page.getByRole("button", { name: "What depends on Battery, LiPo 2000 mAh?" }).click();

  const panel = page.getByRole("complementary");
  // On a project whose graph has never been built, opening the panel builds
  // it — so this also covers every project that predates the graph.
  await expect(panel.getByText(/would need another look/)).toBeVisible({ timeout: 90_000 });

  // Directly powered by the cell: a structural link, labelled as such.
  await expect(panel.getByRole("link", { name: "U1 Arduino Nano controller" })).toBeVisible();
  // Five derived hops away: cell -> MCU -> its schematic part -> net -> pin ->
  // the firmware that drives the pin. Nothing about this link was typed in.
  await expect(panel.getByRole("link", { name: "src/main.cpp" })).toBeVisible();
  // The bench test is aimed at BT1, so it verifies the thing that changed.
  await expect(panel.getByRole("link", { name: "Battery life bench test" })).toBeVisible();
  // Name-derived housing is a guess, and says so.
  await expect(panel.getByText("Likely").first()).toBeVisible();

  // Wiring intermediates are available but folded away by default.
  await expect(panel.getByRole("link", { name: "net LED_CTRL" })).toHaveCount(0);
  await panel.getByRole("button", { name: /Show \d+ wiring links/ }).click();
  await expect(panel.getByRole("link", { name: "net LED_CTRL" })).toBeVisible();

  await panel.getByRole("button", { name: /Flag these for review/ }).click();
  await expect(panel.getByRole("button", { name: /Flagged \d+ for review/ })).toBeVisible();
  await panel.getByRole("button", { name: "Close impact panel" }).first().click();

  // The flag lands on the BOM row of a powered part…
  const mcuRow = page.getByRole("row", { name: /Arduino Nano controller/ });
  await expect(mcuRow.getByText("Review")).toBeVisible();
  // …and not on the part that changed.
  const batteryRow = page.getByRole("row", { name: /Battery, LiPo 2000 mAh/ });
  await expect(batteryRow.getByText("Review")).toHaveCount(0);

  // …and on the check in a different tab, with nobody navigating there first.
  await page.goto(`${PROJECT}?view=verify`);
  // The badge renders inside the title element, so match on containment.
  const check = page.locator("p", { hasText: "Battery life bench test" }).first();
  await expect(check).toBeVisible({ timeout: 60_000 });
  await expect(check.getByText("Review")).toBeVisible();
});
