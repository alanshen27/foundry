import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 0 acceptance journey (PRD 25):
 * sign in -> (workspace already exists) -> create project -> invite a collaborator ->
 * collaborator accepts -> both navigate the four stages.
 * Requires the seed users (pnpm db:seed) and AUTH_MODE=local.
 */

const runId = Date.now().toString(36);

async function signIn(page: Page, email: string) {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Signed-in home is the primary workspace slug, not the all-workspaces list.
  await page.waitForURL(/\/w\/[^/]+$/);
}

test("full Phase 0 journey", async ({ browser }) => {
  const builderContext = await browser.newContext();
  const builder = await builderContext.newPage();

  await signIn(builder, "builder@foundry.local");

  // Optional extra workspace via manage list
  await builder.goto("/workspaces?manage=1");
  const workspaceName = `E2E Workspace ${runId}`;
  await builder.getByLabel("Workspace name").fill(workspaceName);
  await builder.getByRole("button", { name: "Create" }).click();
  await builder.waitForURL("**/w/e2e-workspace-*");
  await expect(builder.getByRole("heading", { name: workspaceName })).toBeVisible();

  // Create project
  await builder.getByLabel("Project name").fill("Test Rover");
  await builder.getByLabel("Project description").fill("Phase 0 acceptance project");
  await builder.getByRole("button", { name: "Create project" }).click();
  await builder.waitForURL("**/projects/test-rover/overview");
  await expect(builder.getByRole("heading", { name: "Test Rover" })).toBeVisible();

  // Walk the footer process bar and check the real editors render.
  // Clicks retry because dev-mode hydration can swallow the first one.
  const stageMarkers: [string, RegExp, string][] = [
    ["Ideation", /\/ideate$/, "Product brief"],
    ["Engineer", /\/engineer/, "In this scene"],
    ["Verify", /\/verify$/, "Validation checklist"],
    ["Launch", /\/launch$/, "Cut a release"],
  ];
  for (const [step, url, marker] of stageMarkers) {
    await expect(async () => {
      await builder
        .getByRole("navigation", { name: "Design process" })
        .getByRole("link", { name: step })
        .click();
      await builder.waitForURL(url, { timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
    await expect(builder.getByText(marker).first()).toBeVisible({ timeout: 30_000 });
  }

  // Invite the reviewer
  await builder.goto(builder.url().replace(/\/projects\/.*$/, "/settings"));
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
  await reviewer.goto(invitePath);
  await reviewer.getByRole("button", { name: "Accept invitation" }).click();
  await reviewer.waitForURL("**/w/e2e-workspace-*");
  await expect(reviewer.getByRole("heading", { name: workspaceName })).toBeVisible();

  // Reviewer can open the project and see stage statuses
  await reviewer.getByRole("link", { name: /Test Rover/ }).click();
  await reviewer.waitForURL("**/projects/test-rover/overview");
  await expect(reviewer.getByRole("heading", { name: "Test Rover" })).toBeVisible();

  // Builder sees both members in settings
  await builder.reload();
  await expect(builder.getByText("reviewer@foundry.local")).toBeVisible();

  await builderContext.close();
  await reviewerContext.close();
});

test("chat channels and visual CAD parameters", async ({ page }) => {
  await signIn(page, "builder@foundry.local");

  // Fresh workspace + project for this test.
  await page.getByLabel("Workspace name").fill(`E2E Studio ${runId}`);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL("**/w/e2e-studio-*");
  await page.getByLabel("Project name").fill("Param Rig");
  await page.getByLabel("Project description").fill("Channels + params test");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL("**/projects/param-rig/overview");

  // --- Copilot channels: create one, switch, persist across reloads.
  await page.getByRole("button", { name: /General/ }).click();
  await page.getByRole("button", { name: "New channel" }).click();
  await page.getByLabel("New channel name").fill("enclosure");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  // The header switches to the new (empty) channel.
  await expect(page.getByRole("button", { name: /enclosure/ })).toBeVisible();

  await page.reload();
  // Default channel after reload is General; the new channel is listed.
  const channelButton = page.getByRole("button", { name: /General/ });
  await expect(channelButton).toBeVisible();
  await channelButton.click();
  await expect(page.getByRole("listbox").getByText("enclosure")).toBeVisible();
  await page.keyboard.press("Escape");

  // --- Visual CAD parameters: edit a value, autosave, survive reload.
  await page.goto(page.url().replace(/\/overview.*$/, "/engineer?view=model"));
  await expect(page.getByText("Parameters")).toBeVisible({ timeout: 60_000 });
  const width = page.locator('label:has-text("width") input[type="number"]');
  await expect(width).toHaveValue("60");
  // Editing the control rewrites the script and autosaves (900ms debounce).
  const saved = page.waitForResponse((r) => r.url().includes("design.save") && r.ok(), {
    timeout: 30_000,
  });
  await width.fill("75");
  await saved;
  await page.reload();
  await expect(page.locator('label:has-text("width") input[type="number"]')).toHaveValue("75", {
    timeout: 30_000,
  });
});

test("unauthenticated users are redirected to sign-in", async ({ page }) => {
  await page.goto("/workspaces");
  await page.waitForURL("**/auth/sign-in**");
  await expect(page.getByText("Sign in to FOUNDRY")).toBeVisible();
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
