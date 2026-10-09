import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPythonCad } from "../src/build123d";
import { pythonCadDoc, upsertPythonPart } from "../src/doc";
import { buildPythonProject } from "../src/python-project";
import { buildLinkedAssembly } from "../src/linked-assembly";
const hasRuntime =
  process.platform === "darwin" &&
  (() => {
    try {
      execSync("uv --version", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
const box = "from build123d import Box\nresult = Box(10,20,5)\n";
const run = (source: string, options = {}) =>
  runPythonCad({ files: { "main.py": source }, entryPath: "main.py", ...options });

describe("native Python runner validation", () => {
  it("honors already-cancelled work before resolving runtime", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await run(box, { signal: controller.signal, uvCommand: "must-never-launch" })).toEqual({
      ok: false,
      error: "build123d run cancelled",
    });
  });
  it.skipIf(process.platform !== "darwin")(
    "rejects invalid source and asset paths before execution",
    async () => {
      expect(
        await runPythonCad({
          entryPath: "../main.py",
          files: { "../main.py": box },
          uvCommand: "must-never-launch",
        }),
      ).toMatchObject({ ok: false, error: expect.stringContaining("Invalid Python CAD source") });
      expect(
        await run(box, {
          assets: { "../outside.step": new Uint8Array([1]) },
          uvCommand: "must-never-launch",
        }),
      ).toMatchObject({ ok: false, error: expect.stringContaining("Invalid Python CAD asset") });
    },
  );
});

describe.skipIf(!hasRuntime)("native Python runner with mandatory macOS sandbox", () => {
  it(
    "exports exact STEP with a cavity and computes solid volume and bounds",
    { timeout: 30_000 },
    async () => {
      const result = await run(
        "from build123d import Box, Cylinder\nresult = Box(20,20,8) - Cylinder(radius=3,height=8)\n",
      );
      expect(result.ok, result.ok ? "" : result.error).toBe(true);
      if (!result.ok) return;
      expect(result.data.step.toString("ascii")).toContain("ISO-10303-21");
      expect(result.data.step.toString("ascii")).toContain("CYLINDRICAL_SURFACE");
      expect(result.data.volumeMm3).toBeCloseTo(20 * 20 * 8 - Math.PI * 3 * 3 * 8, 4);
      expect(result.data.bbox.dimensions).toEqual({ x: 20, y: 20, z: 8 });
      expect(result.data.valid).toBe(true);
      expect(result.data.solidCount).toBe(1);
    },
  );
  it(
    "executes linked source copies with independent placements and retains distinct solids",
    { timeout: 30_000 },
    async () => {
      const doc = buildLinkedAssembly(upsertPythonPart(pythonCadDoc(), "bracket", box));
      const original = doc.assembly!.instances[0]!;
      const placed = buildLinkedAssembly(doc, [
        original,
        {
          ...original,
          id: "second",
          translationMm: { x: 30, y: 0, z: 0 },
          rotationDeg: { x: 0, y: 0, z: 90 },
        },
      ]);
      const project = buildPythonProject(placed, "assembly/product.py");
      const result = await runPythonCad({ files: project.files, entryPath: project.entryPath });
      expect(result.ok, result.ok ? "" : result.error).toBe(true);
      if (!result.ok) return;
      expect(result.data.solidCount).toBe(2);
      expect(result.data.volumeMm3).toBeCloseTo(2000, 6);
      expect(result.data.bbox.dimensions.x).toBeCloseTo(45, 6);
    },
  );
  it(
    "packs source colours per solid, inheriting a parent's colour",
    { timeout: 30_000 },
    async () => {
      const result = await run(
        [
          "from build123d import Box, Color, Compound, Pos",
          "lens = Box(4,4,1); lens.label = 'lens'; lens.color = Color(0, 0, 1, 0.5)",
          "cap = Pos(10,0,0) * Box(2,2,2); cap.label = 'cap'",
          "shell = Pos(20,0,0) * Box(3,3,3); shell.label = 'shell'",
          "accents = Compound(children=[cap]); accents.label = 'accents'; accents.color = 'orange'",
          "result = Compound(children=[lens, accents, shell])",
        ].join("\n"),
      );
      expect(result.ok, result.ok ? "" : result.error).toBe(true);
      if (!result.ok) return;
      const mesh = Buffer.from(result.data.stl);
      expect(mesh.subarray(0, 8).toString("ascii")).toBe("FDRYMSH2");
      const colors: Record<string, number> = {};
      let offset = 12;
      for (let i = 0; i < mesh.readUInt32LE(8); i += 1) {
        const nameLength = mesh.readUInt16LE(offset);
        const stlLength = mesh.readUInt32LE(offset + 2);
        const name = mesh.subarray(offset + 10, offset + 10 + nameLength).toString("utf8");
        colors[name] = mesh.readUInt32LE(offset + 6);
        offset += 10 + nameLength + stlLength;
      }
      expect(colors.lens).toBe(0x0000ff80);
      expect(colors.shell).toBe(0);
      // OCCT's named orange is its own shade; assert red-dominant and opaque.
      expect(colors.cap! >>> 24).toBe(0xff);
      expect(colors.cap! & 0xff).toBe(0xff);
      expect((colors.cap! >>> 8) & 0xff).toBeLessThan(0x40);
    },
  );
  it("resolves relative source imports at the selected entry", { timeout: 30_000 }, async () => {
    const result = await runPythonCad({
      files: {
        "parts/a/main.py":
          "from .dimensions import width\nfrom build123d import Box\nresult = Box(width,2,3)",
        "parts/a/dimensions.py": "width = 7\n",
      },
      entryPath: "parts/a/main.py",
    });
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
    if (result.ok) expect(result.data.bbox.dimensions).toEqual({ x: 7, y: 2, z: 3 });
  });
  it(
    "blocks host reads, ambient credentials, network and child processes at runtime",
    { timeout: 30_000 },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "foundry-outside-sandbox-"));
      const path = join(dir, "private-test.txt");
      const prior = process.env.FOUNDRY_SANDBOX_TEST_SECRET;
      process.env.FOUNDRY_SANDBOX_TEST_SECRET = "synthetic-secret-never-export";
      await writeFile(path, "synthetic-host-file");
      try {
        const source = `import os, pathlib, socket, subprocess\nfrom build123d import Box\nassert "FOUNDRY_SANDBOX_TEST_SECRET" not in os.environ\ndef must_deny(operation):\n    try:\n        operation()\n    except PermissionError:\n        return\n    raise AssertionError("sandbox unexpectedly allowed protected operation")\nmust_deny(lambda: pathlib.Path(${JSON.stringify(path)}).read_text())\nmust_deny(lambda: socket.socket().connect(("127.0.0.1",9)))\nmust_deny(lambda: subprocess.run(["/bin/echo","unexpected"],check=True))\nresult = Box(1,2,3)\n`;
        const result = await run(source);
        expect(result.ok, result.ok ? "" : result.error).toBe(true);
      } finally {
        if (prior === undefined) delete process.env.FOUNDRY_SANDBOX_TEST_SECRET;
        else process.env.FOUNDRY_SANDBOX_TEST_SECRET = prior;
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
  it(
    "cancels work during execution and bounds noisy or stalled source",
    { timeout: 30_000 },
    async () => {
      const controller = new AbortController();
      const pending = run("import time\ntime.sleep(60)\n" + box, { signal: controller.signal });
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        expect(await pending).toMatchObject({
          ok: false,
          error: expect.stringContaining("cancelled"),
        });
      } finally {
        clearTimeout(timer);
      }
      expect(await run("while True:\n    print('x'*8192)\n", { timeoutMs: 10_000 })).toMatchObject({
        ok: false,
        error: expect.stringContaining("output limit"),
      });
      expect(await run("import time\ntime.sleep(60)\n", { timeoutMs: 2000 })).toMatchObject({
        ok: false,
        error: expect.stringContaining("exceeded"),
      });
    },
  );
  it(
    "rejects non-solid results rather than presenting an unvalidated mesh as CAD",
    { timeout: 30_000 },
    async () => {
      expect(
        await run("from build123d import Rectangle\nresult = Rectangle(10,20)\n"),
      ).toMatchObject({ ok: false, error: expect.stringContaining("solid geometry") });
    },
  );
});
