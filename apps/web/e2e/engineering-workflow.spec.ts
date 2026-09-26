import { expect, test, type Page } from "@playwright/test";
import type { CadDoc } from "@foundry/cad";
import type { PcbSet } from "../lib/pcb/doc";

type LabState = {
  pcb: PcbSet;
  cad: CadDoc;
  calls: { path: string; input: Record<string, unknown> }[];
};
async function state(page: Page): Promise<LabState> {
  return JSON.parse((await page.getByTestId("engineering-lab-state").textContent())!);
}
async function openLab(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto("/dev/engineering-lab");
  await expect(
    page.getByRole("heading", { name: "Engineering lab · LOCAL / UNVERIFIED" }),
  ).toBeVisible();
  await expect(page.getByLabel("Active board")).toHaveValue("main-board", { timeout: 30_000 });
}

test("links schematic parts and package pins, preserves physical layout and copper, and requires explicit packages", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const apiCalls: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
  });
  await openLab(page);
  const initial = await state(page);
  // The footprint's immediate SVG group is the real editor selection target.
  const led = page
    .locator('svg[aria-label="PCB board canvas"] text')
    .filter({ hasText: /^LED1$/ })
    .locator("..");
  await led.click();
  await expect(page.getByLabel("Reference designator")).toHaveValue("LED1");
  await page.getByLabel("Linked schematic part").selectOption("led-main");
  await page.getByLabel("Pad for schematic pin A", { exact: true }).selectOption("1");
  await page.getByLabel("Pad for schematic pin C", { exact: true }).selectOption("2");
  await page.getByLabel("Package height in millimetres").fill("1.7");
  await expect
    .poll(async () => (await state(page)).pcb.boards[0]?.footprints[0]?.bodyHeightMm)
    .toBe(1.7);
  const mapped = (await state(page)).pcb.boards[0]!.footprints[0]!;
  expect(mapped).toMatchObject({
    id: "footprint-led",
    partId: "led-main",
    pinMap: { A: "1", C: "2" },
    xMm: 20,
    yMm: 20,
    rotationDeg: 0,
    side: "front",
  });

  await page
    .getByRole("button", { name: "Update PCB from schematic", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Update PCB from schematic" });
  await expect(dialog.getByLabel("Package for LED1")).toHaveValue("LED_0805");
  await expect(dialog.getByLabel("Package for R1")).toHaveValue("R_0603");
  await expect(dialog.getByLabel("Package for U1")).toHaveValue("");
  await dialog.getByRole("button", { name: "Apply package assignments" }).click();
  await expect(dialog.getByRole("status")).toContainText("U1: choose a physical package");
  expect(
    (await state(page)).pcb.boards[0]!.footprints.some((fp) => fp.partId === "controller-main"),
  ).toBe(false);
  // Only this explicit user choice creates a controller package in the local fixture.
  await dialog.getByLabel("Package for U1").selectOption("QFN-16-3x3");
  await dialog.getByRole("button", { name: "Apply package assignments" }).click();
  await expect(dialog.getByRole("status")).toContainText("1 added");
  await expect.poll(async () => (await state(page)).pcb.boards[0]?.footprints.length).toBe(3);
  const updated = await state(page);
  expect(updated.pcb.boards[0]?.tracks).toEqual(initial.pcb.boards[0]?.tracks);
  expect(updated.pcb.boards[1]).toEqual(initial.pcb.boards[1]);
  expect(updated.pcb.boards[0]?.footprints.find((fp) => fp.id === "footprint-led")).toEqual(mapped);
  expect(
    updated.pcb.boards[0]?.footprints.find((fp) => fp.id === "footprint-resistor"),
  ).toMatchObject({ xMm: 40, yMm: 20, rotationDeg: 90, side: "back", bodyHeightMm: 0.5 });
  await page.screenshot({ path: testInfo.outputPath("schematic-package-mapping.png") });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Active board").selectOption("aux-board");
  await expect(
    page.locator('svg[aria-label="PCB board canvas"] text').filter({ hasText: /^LED2$/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(apiCalls).toEqual([]);
});

test("hands both boards to CAD, builds and edits linked assembly placements, and keeps live drafts separate", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openLab(page);
  const workflow = page.getByRole("region", { name: "Connected engineering workflow" });
  const canvas = page.getByLabel("PCB board canvas");
  const beforeInspector = await canvas.boundingBox();
  expect((await workflow.boundingBox())!.height).toBeLessThanOrEqual(40);
  await expect(workflow.getByRole("spinbutton")).toHaveCount(0);
  await workflow.locator('button[aria-controls="engineering-workflow-details"]').click();
  await expect(workflow.getByText("LOCAL / UNVERIFIED", { exact: false })).toBeVisible();
  expect((await canvas.boundingBox())!.height).toBe(beforeInspector!.height);
  expect((await canvas.boundingBox())!.y).toBe(beforeInspector!.y);
  expect(
    (await workflow.getByRole("complementary", { name: "Engineering inspector" }).boundingBox())!
      .width,
  ).toBeLessThanOrEqual(320);
  await expect(
    workflow.getByRole("button", { name: "Build linked assembly", exact: true }),
  ).toBeDisabled();
  await workflow.getByRole("button", { name: "Update CAD from boards", exact: true }).click();
  await expect(workflow.getByRole("status")).toContainText("CAD board parts updated");
  const synced = await state(page);
  expect(synced.cad.components.map((part) => part.source?.boardId).sort()).toEqual([
    "aux-board",
    "main-board",
  ]);
  expect(synced.calls.at(-1)).toMatchObject({
    path: "engineering.syncPcbToCad",
    input: { expectedFingerprint: "local-0" },
  });
  await workflow.getByRole("button", { name: "Build linked assembly", exact: true }).click();
  await expect(workflow.getByRole("status")).toContainText("Linked assembly built");
  await expect(page.getByText("Selected view: assembly", { exact: true })).toBeVisible();
  const built = await state(page);
  expect(built.cad.assembly?.instances).toHaveLength(2);
  expect(built.cad.components.filter((part) => part.kind === "part")).toEqual(
    synced.cad.components,
  );
  const placement = workflow.getByLabel(/position Z$/).first();
  await placement.fill("8.5");
  await workflow.getByRole("button", { name: "Save placements", exact: true }).click();
  await expect(workflow.getByRole("status")).toContainText("Assembly placements saved");
  const saved = await state(page);
  expect(saved.cad.assembly?.instances[0]?.translationMm.z).toBe(8.5);
  expect(saved.calls.at(-1)).toMatchObject({
    path: "engineering.buildAssembly",
    input: { expectedFingerprint: "local-2", instances: expect.any(Array) },
  });
  await page.screenshot({ path: testInfo.outputPath("assembly-side-inspector.png") });
  await workflow.getByRole("button", { name: "Close engineering inspector" }).click();
  await expect(workflow.getByRole("complementary", { name: "Engineering inspector" })).toBeHidden();
  await page.getByRole("button", { name: "Show live draft", exact: true }).click();
  const draft = page.getByTestId("live-cad-drafts");
  await draft.locator("summary").click();
  await expect(draft).toContainText("parts/enclosure.kcl");
  await expect(draft.locator("pre")).toContainText("height =");
  expect((await state(page)).cad).toEqual(saved.cad);
  await page.screenshot({ path: testInfo.outputPath("linked-assembly-and-live-draft.png") });
  await page.getByRole("button", { name: "Clear live draft", exact: true }).click();
  await expect(draft).toHaveCount(0);
  expect(errors).toEqual([]);
});
