import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 0 acceptance journey (PRD 25):
 * sign in -> create workspace -> create project -> invite a collaborator ->
 * collaborator accepts -> both navigate the four stages.
 * Requires the seed users (pnpm db:seed) and AUTH_MODE=local.
 */

const runId = Date.now().toString(36);

async function signIn(page: Page, email: string) {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/workspaces");
}

test("full Phase 0 journey", async ({ browser }) => {
  const builderContext = await browser.newContext();
  const builder = await builderContext.newPage();

  await signIn(builder, "builder@foundry.local");

  // Create workspace
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

  // Navigate the four stages and check their real editors render
  const stageMarkers: [string, string | RegExp][] = [
    ["Ideate", "Product brief"],
    ["Engineer", "Est. unit cost"],
    ["Verify", "Validation checklist"],
    ["Launch", "Cut a release"],
  ];
  for (const [stage, marker] of stageMarkers) {
    await builder
      .getByRole("navigation", { name: "Stages" })
      .getByRole("link", { name: stage })
      .click();
    await expect(builder.getByText(marker).first()).toBeVisible();
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

test("unauthenticated users are redirected to sign-in", async ({ page }) => {
  await page.goto("/workspaces");
  await page.waitForURL("**/auth/sign-in**");
  await expect(page.getByText("Sign in to FOUNDRY")).toBeVisible();
});
