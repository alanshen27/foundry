import { expect, test } from "@playwright/test";
import * as THREE from "three";

/** Self-contained asymmetric glTF fixture; no credentials or live engine needed. */
function meshFixture(): Buffer {
  const geometry = new THREE.BoxGeometry(0.12, 0.04, 0.08);
  const position = Buffer.from(geometry.attributes.position!.array.buffer);
  const normal = Buffer.from(geometry.attributes.normal!.array.buffer);
  const indices = Buffer.from(geometry.index!.array.buffer);
  const binary = Buffer.concat([position, normal, indices]);
  const gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "Fixture housing" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.3, 0.5, 0.7, 1],
          metallicFactor: 0.3,
          roughnessFactor: 0.6,
        },
      },
    ],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: position.length, target: 34962 },
      { buffer: 0, byteOffset: position.length, byteLength: normal.length, target: 34962 },
      {
        buffer: 0,
        byteOffset: position.length + normal.length,
        byteLength: indices.length,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 24,
        type: "VEC3",
        min: [-0.06, -0.02, -0.04],
        max: [0.06, 0.02, 0.04],
      },
      { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 36, type: "SCALAR" },
    ],
  };
  const source = JSON.stringify(gltf);
  const json = Buffer.from(source.padEnd(Math.ceil(Buffer.byteLength(source) / 4) * 4, " "));
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + binary.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  geometry.dispose();
  return Buffer.concat([header, json, binHeader, binary]);
}

test("CAD renders local geometry, picks bodies, orbits and captures without a video stream", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let exports = 0;
  const requests: Array<{ engine?: string; entryPath?: string; script?: string }> = [];
  // The fixture stands in for the sandboxed build123d kernel, which only runs on macOS.
  await page.route("**/api/cad/mesh", async (route) => {
    exports += 1;
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "model/gltf-binary", body: meshFixture() });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/dev/python-cad-lab");
  const viewport = page.locator('[data-cad-renderer="three"]');
  await expect(viewport).toHaveAttribute("data-cad-status", "running", { timeout: 60_000 });
  expect(requests[0]).toMatchObject({ engine: "build123d", entryPath: "main.py" });
  expect(requests[0]!.script).toContain("width = 50");
  const initialExports = exports;
  const canvas = viewport.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(viewport.locator("video")).toHaveCount(0);
  await canvas.hover();
  await expect(viewport.getByText("Fixture housing", { exact: true })).toBeVisible();
  await canvas.click();
  await page.screenshot({ path: testInfo.outputPath("three-viewport.png") });
  await viewport.getByRole("button", { name: "Orthographic projection", exact: true }).click();
  await expect(
    viewport.getByRole("button", { name: "Perspective projection", exact: true }),
  ).toBeVisible();
  await viewport.getByRole("button", { name: "Fit all", exact: true }).click();
  const box = (await canvas.boundingBox())!;
  const before = await canvas.screenshot();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  const after = await canvas.screenshot();
  expect(before.equals(after)).toBe(false);
  const download = page.waitForEvent("download");
  await viewport.getByRole("button", { name: "Capture PNG of current view", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/foundry-view-.*\.png/);
  // Navigation, selection, projection, fitting and capture reuse the same real mesh.
  expect(exports).toBe(initialExports);
  // A dimension edit is new source, so it rebuilds.
  await page.getByRole("button", { name: /Change width/ }).click();
  await expect.poll(() => requests.at(-1)?.script ?? "").toContain("width = 70");
  await expect(viewport).toHaveAttribute("data-cad-status", "running");
  expect(errors).toEqual([]);
});
