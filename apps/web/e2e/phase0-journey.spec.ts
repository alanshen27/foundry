import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 0 acceptance journey (PRD 25):
 * sign in -> (workspace already exists) -> create project -> invite a collaborator ->
 * collaborator accepts -> both navigate the four stages.
 * Requires the seed users (pnpm db:seed) and AUTH_MODE=local.
 */

const runId = Date.now().toString(36);

/**
 * page.goto that survives a client-side navigation still in flight.
 *
 * The workspace updates its own URL (tab changes call router.replace), and a
 * goto issued while that is settling is aborted by the browser with
 * net::ERR_ABORTED — not a failure of the page being opened. Retry only that.
 */
async function gotoSettled(page: Page, url: string) {
  for (let attempt = 1; ; attempt++) {
    await page.waitForLoadState("load");
    try {
      await page.goto(url);
      return;
    } catch (err) {
      if (attempt >= 3 || !String(err).includes("ERR_ABORTED")) throw err;
    }
  }
}

async function signIn(page: Page, email: string) {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Signed-in home is the primary workspace slug, not the all-workspaces list.
  await page.waitForURL(/\/w\/[^/]+$/);
  // Let the landing page finish loading: navigating away while the client
  // router is still settling aborts the next page.goto (net::ERR_ABORTED).
  await page.waitForLoadState("load");
}

test("full Phase 0 journey", async ({ browser }) => {
  // A cold dev server compiles every stage the first time it is opened, which
  // alone can exceed the default 60s budget.
  test.setTimeout(240_000);
  const builderContext = await browser.newContext();
  const builder = await builderContext.newPage();

  await signIn(builder, "builder@foundry.local");

  // Optional extra workspace via manage list (separate from the project chatbar)
  await gotoSettled(builder, "/workspaces?manage=1");
  const workspaceName = `E2E Workspace ${runId}`;
  await builder.getByLabel("Workspace name").fill(workspaceName);
  await builder.getByRole("button", { name: "Create" }).click();
  await builder.waitForURL("**/w/e2e-workspace-*");
  await expect(builder.getByRole("heading", { name: workspaceName })).toBeVisible();
  const workspaceSlug = new URL(builder.url()).pathname.split("/")[2]!;

  // Large project chatbar → Project row under this workspace (not a new Workspace)
  await builder
    .getByLabel("Describe the product to build")
    .fill("A palm-sized two-wheel rover for phase 0 acceptance.");
  await builder.getByRole("button", { name: "More" }).click();
  await builder.getByLabel("Project name").fill("Test Rover");
  await builder.getByRole("button", { name: "Build" }).click();
  await builder.waitForURL(`**/w/${workspaceSlug}/projects/test-rover/engineer`);
  expect(builder.url()).toMatch(new RegExp(`/w/${workspaceSlug}/projects/test-rover`));
  expect(builder.url()).not.toMatch(/\/w\/test-rover(?:\/|$)/);
  await expect(builder.getByRole("heading", { name: "Test Rover" })).toBeVisible();

  // Walk the project through the window menu. Assembly stays on the page;
  // other surfaces open as tabs from that one control.
  const stageTabs: [string, string, string][] = [
    ["Ideate", "ideate", "Product brief"],
    ["Verify", "verify", "Validation checklist"],
    ["Launch", "launch", "Cut a release"],
    ["Assembly", "assembly", "Test Rover"],
  ];
  const documents = builder.getByRole("navigation", { name: "Open documents" });
  for (const [tab, view, marker] of stageTabs) {
    await expect(async () => {
      if (view === "assembly") {
        await documents.getByRole("button", { name: "Assembly", exact: true }).click();
      } else {
        await builder.getByRole("button", { name: "Open window", exact: true }).click();
        await builder.getByRole("menuitem", { name: tab, exact: true }).click();
      }
      const current = documents.getByRole("button", { name: tab, exact: true });
      await expect(current).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    if (view !== "assembly") await expect(builder).toHaveURL(new RegExp(`view=${view}`));
    await expect(builder.getByText(marker).first()).toBeVisible({ timeout: 60_000 });
  }

  // Invite the reviewer
  await gotoSettled(builder, builder.url().replace(/\/projects\/.*$/, "/settings"));
  await builder.getByLabel("Invitee email").fill("reviewer@foundry.local");
  await builder.getByRole("button", { name: "Invite" }).click();
  await expect(builder.getByText("Invitation created")).toBeVisible();
  const inviteLinkText = await builder.getByTestId("invite-link").first().innerText();
  const invitePath = inviteLinkText.replace("Invite link:", "").trim();
  expect(invitePath).toMatch(/^\/invite\//);

  // Reviewer accepts in a separate session
  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await signIn(reviewer, "reviewer@foundry.local");
  await gotoSettled(reviewer, invitePath);
  await reviewer.getByRole("button", { name: "Accept invitation" }).click();
  await reviewer.waitForURL("**/w/e2e-workspace-*");
  await expect(reviewer.getByRole("heading", { name: workspaceName })).toBeVisible();

  // Reviewer can open the project and see stage statuses
  await reviewer.getByRole("link", { name: /Test Rover/ }).click();
  await reviewer.waitForURL("**/projects/test-rover/engineer");
  await expect(reviewer.getByRole("heading", { name: "Test Rover" })).toBeVisible();

  // Shared work has no place in the reviewer's own folder tree, so their home
  // sidebar lists it flat under "Shared with me".
  await gotoSettled(reviewer, "/");
  await reviewer.waitForURL(/\/w\/[^/]+$/);
  await expect(
    reviewer
      .getByTestId("shared-with-me")
      .getByRole("link", { name: /Test Rover/ })
      .first(),
  ).toBeVisible();

  // Builder sees both members in settings
  await builder.reload();
  await expect(builder.getByText("reviewer@foundry.local")).toBeVisible();

  await builderContext.close();
  await reviewerContext.close();
});

test("chat channels and visual CAD parameters", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "builder@foundry.local");

  // Fresh workspace (manage form) + project via large chatbar — not workspace-named-as-project.
  await gotoSettled(page, "/workspaces?manage=1");
  await page.getByLabel("Workspace name").fill(`E2E Studio ${runId}`);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL("**/w/e2e-studio-*");
  const workspaceSlug = new URL(page.url()).pathname.split("/")[2]!;
  await page
    .getByLabel("Describe the product to build")
    .fill("A rig for testing CAD parameters and chat channels.");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByLabel("Project name").fill("Param Rig");
  await page.getByRole("button", { name: "Build" }).click();
  await page.waitForURL(`**/w/${workspaceSlug}/projects/param-rig/engineer`);
  expect(page.url()).not.toMatch(/\/w\/param-rig(?:\/|$)/);

  // --- Copilot channels: create one, switch, persist across reloads.
  await page.getByRole("button", { name: /General/ }).click();
  await page.getByRole("button", { name: "New channel" }).click();
  // "New channel" is the dialog title; the field itself is labelled "Channel name".
  await page.getByRole("dialog").getByLabel("Channel name").fill("enclosure");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  // The header switches to the new (empty) channel.
  await expect(page.getByRole("button", { name: /enclosure/ })).toBeVisible({ timeout: 15_000 });

  await page.reload();
  // Default channel after reload is General; the new channel is listed.
  const channelButton = page.getByRole("button", { name: /General/ });
  await expect(channelButton).toBeVisible();
  await channelButton.click();
  await expect(page.getByRole("listbox").getByText("enclosure")).toBeVisible();
  await page.keyboard.press("Escape");

  // --- Visual CAD parameters: edit a value, autosave, survive reload.
  await gotoSettled(page, page.url().replace(/\/engineer.*$/, "/engineer?view=model"));
  // Parameters live in the CAD Inspector, collapsed by default.
  const inspector = page.getByRole("button", { name: /Inspector/ });
  await expect(inspector).toBeVisible({ timeout: 90_000 });
  if ((await inspector.getAttribute("aria-expanded")) !== "true") await inspector.click();
  await expect(page.getByText("Part parameters")).toBeVisible();
  const width = page.locator('label:has-text("width") input[type="number"]');
  await expect(width).toHaveValue("60");
  // Editing the control rewrites the script and autosaves (900ms debounce).
  const saved = page.waitForResponse((r) => r.url().includes("design.save") && r.ok(), {
    timeout: 30_000,
  });
  await width.fill("75");
  await saved;
  await page.reload();
  const reopened = page.getByRole("button", { name: /Inspector/ });
  await expect(reopened).toBeVisible({ timeout: 90_000 });
  if ((await reopened.getAttribute("aria-expanded")) !== "true") await reopened.click();
  await expect(page.locator('label:has-text("width") input[type="number"]')).toHaveValue("75", {
    timeout: 30_000,
  });
});

test("sites chatbar creates a Site under the workspace, not a Workspace", async ({ page }) => {
  await signIn(page, "builder@foundry.local");

  await gotoSettled(page, "/workspaces?manage=1");
  await page.getByLabel("Workspace name").fill(`E2E Sites ${runId}`);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL("**/w/e2e-sites-*");
  const workspaceSlug = new URL(page.url()).pathname.split("/")[2]!;

  await gotoSettled(page, `/w/${workspaceSlug}/sites`);
  await page.getByLabel("Describe the site to build").fill("E2E Launch Site");
  await page.getByRole("button", { name: "Build" }).click();
  await page.waitForURL(`**/w/${workspaceSlug}/sites/e2e-launch-site/editor`, {
    timeout: 60_000,
  });
  expect(page.url()).toContain(`/w/${workspaceSlug}/sites/`);
  expect(page.url()).not.toMatch(/\/w\/e2e-launch-site(?:\/|$)/);
});

test("unauthenticated users are redirected to sign-in", async ({ page }) => {
  await gotoSettled(page, "/workspaces");
  await page.waitForURL("**/auth/sign-in**");
  // Match the heading, not the submit button, which is also labelled "Sign in".
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("render pages and project files require valid tokens/session", async ({ request }) => {
  // Copilot screenshot targets: no token or a forged token must 404.
  for (const path of [
    "/render/model3d",
    "/render/circuit",
    "/render/circuit?token=abc.def",
    "/render/pcb",
    "/render/pcb?token=abc.def",
  ]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
  }
  // Stored project files (concept images, renders) require a session.
  const files = await request.get("/api/files/projects/some-project/ai/x.png");
  expect(files.status()).toBe(401);
});
