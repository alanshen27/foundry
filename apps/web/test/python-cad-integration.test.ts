import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  buildLinkedAssembly,
  cadDoc,
  linkedAssemblyStatus,
  normalizeCadDoc,
  pythonCadDoc,
  stableCadHash,
  updateComponentContent,
  type CadDoc,
} from "@foundry/cad";
import { applyDesignSnapshot, readDesignDocument } from "@foundry/collaboration/client";
import { normalizePcbSet } from "@/lib/pcb/doc";
import { pcbMechanicalSourceHash } from "@/lib/pcb/mechanical";
import { pcbPartPython, pcbPythonPath } from "@/lib/pcb/python";
import { cadViewportInput } from "@/lib/cad/viewport-project";
import { syncPcbCadParts } from "@/server/assemble-product";

function boards() {
  return normalizePcbSet({
    version: 2,
    boards: [
      {
        id: "recorder",
        name: "Recorder PCB",
        board: { widthMm: 60, heightMm: 40, thicknessMm: 1.6, cornerRadiusMm: 3 },
        footprints: [
          {
            id: "mount",
            libraryId: "MountingHole_3.2mm",
            refDes: "H1",
            xMm: 5,
            yMm: 7,
            rotationDeg: 0,
            side: "front",
          },
        ],
      },
    ],
  });
}

describe("native PCB, CAD, assembly and collaboration integration", () => {
  it("builds a linked Python assembly from board dimensions and drills without creating KCL", () => {
    const pcb = boards();
    const board = pcb.boards[0]!;
    const synced = syncPcbCadParts(pythonCadDoc(), pcb);
    expect(synced.conflicts).toEqual([]);
    const part = synced.doc.components.find((c) => c.source?.boardId === board.id)!;
    expect(part.path).toBe(pcbPythonPath(board));
    expect(part.path).toMatch(/^parts\/[a-z0-9_]+\/main\.py$/);
    expect(part.content).toContain("width = 60\ndepth = 40\nthickness = 1.6\ncorner_radius = 3");
    expect(part.content).toContain("Pos(-25, 13, 0) * Cylinder(1.6, thickness");
    expect(part.source).toMatchObject({
      sourceHash: pcbMechanicalSourceHash(board),
      generatedHash: stableCadHash(part.content),
    });
    expect(syncPcbCadParts(synced.doc, pcb).updated).toEqual([]);
    const assembly = buildLinkedAssembly(synced.doc);
    const input = cadViewportInput(assembly, assembly.activeId)!;
    expect(input.engine).toBe("build123d");
    expect(input.entryPath).toBe("assembly/product.py");
    expect(Object.keys(input.projectFiles!).sort()).toEqual(
      ["assembly/product.py", part.path].sort(),
    );
    expect(Object.keys(input.projectFiles!).some((path) => path.endsWith(".kcl"))).toBe(false);
    expect(input.projectFiles![part.path]).toBe(part.content);
    expect(linkedAssemblyStatus(assembly)).toMatchObject({
      linked: true,
      stale: false,
      modified: false,
    });
  });

  it("updates generated Python from a changed board and preserves customized source", () => {
    const pcb = boards();
    const synced = syncPcbCadParts(pythonCadDoc(), pcb).doc;
    const part = synced.components.find((c) => c.source)!;
    pcb.boards[0]!.board.widthMm = 64;
    pcb.boards[0]!.footprints[0]!.xMm = 8;
    const refreshed = syncPcbCadParts(synced, pcb);
    expect(refreshed.conflicts).toEqual([]);
    expect(refreshed.updated).toEqual([part.path]);
    const nextPart = refreshed.doc.components.find((c) => c.id === part.id)!;
    expect(nextPart.content).toContain("width = 64");
    expect(nextPart.content).toContain("Pos(-24, 13, 0)");
    const custom = `${nextPart.content}\n# User clearance adjustment\nresult = result.translate((0, 0, 2))\n`;
    const modified = updateComponentContent(refreshed.doc, part.id, custom);
    const conflict = syncPcbCadParts(modified, pcb);
    expect(conflict.conflicts).toEqual([expect.stringContaining("preserving the custom source")]);
    expect(conflict.doc.components.find((c) => c.id === part.id)?.content).toBe(custom);
    expect(conflict.updated).toEqual([]);
  });

  it("reports a legacy board conversion conflict while preserving its exact file and source", () => {
    const pcb = boards();
    const legacy = syncPcbCadParts(cadDoc("legacy = 1\n"), pcb).doc;
    const part = legacy.components.find((c) => c.source)!;
    const native: CadDoc = { ...legacy, engine: "build123d" };
    const result = syncPcbCadParts(native, pcb);
    expect(result.conflicts).toEqual([expect.stringContaining("preserved legacy PCB source")]);
    expect(result.doc.components.find((c) => c.id === part.id)).toEqual(part);
    expect(
      result.doc.components.filter((c) => c.source?.boardId === pcb.boards[0]!.id),
    ).toHaveLength(1);
    expect(result.updated).toEqual([]);
  });

  it("merges concurrent edits to Python source and retains native engine and legacy data", () => {
    const source =
      "from build123d import Box\nwidth = 40\nheight = 4\nresult = Box(width, 30, height)\n";
    const base = pythonCadDoc(source);
    const part = base.components.find((c) => c.kind === "part")!;
    base.components.push({
      id: "preserved",
      path: "parts/old/main.kcl",
      name: "Old CAD",
      kind: "part",
      content: "// original source\nbody = 1\n",
    });
    const a = new Y.Doc();
    const b = new Y.Doc();
    try {
      applyDesignSnapshot(a, null, base);
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
      applyDesignSnapshot(
        a,
        base,
        updateComponentContent(base, part.id, source.replace("width = 40", "width = 42")),
      );
      applyDesignSnapshot(
        b,
        base,
        updateComponentContent(base, part.id, source.replace("height = 4", "height = 5")),
      );
      const updateA = Y.encodeStateAsUpdate(a);
      const updateB = Y.encodeStateAsUpdate(b);
      Y.applyUpdate(a, updateB);
      Y.applyUpdate(b, updateA);
      expect(readDesignDocument(a)).toEqual(readDesignDocument(b));
      const merged = normalizeCadDoc(readDesignDocument(a));
      expect(merged.engine).toBe("build123d");
      expect(merged.components.find((c) => c.id === part.id)?.content).toContain(
        "width = 42\nheight = 5",
      );
      expect(merged.components.find((c) => c.id === "preserved")).toEqual(base.components.at(-1));
      const input = cadViewportInput(merged, part.id)!;
      expect(input.engine).toBe("build123d");
      expect(input.projectFiles![part.path]).toContain("width = 42\nheight = 5");
    } finally {
      a.destroy();
      b.destroy();
    }
  });
});

// Opt-in local kernel check. No model APIs, project storage, or database are used.
it.skipIf(process.env.RUN_PYTHON_CAD_INTEGRATION !== "1")(
  "exports the known PCB substrate as an exact solid with the declared drill",
  async () => {
    const { runPythonCad } = await import("@foundry/cad/server");
    const board = boards().boards[0]!;
    const path = pcbPythonPath(board);
    const result = await runPythonCad({ files: { [path]: pcbPartPython(board) }, entryPath: path });
    expect(result.ok, result.ok ? undefined : result.error).toBe(true);
    if (!result.ok) return;
    expect(result.data.valid).toBe(true);
    expect(result.data.solidCount).toBe(1);
    expect(result.data.bbox.dimensions.x).toBeCloseTo(60, 6);
    expect(result.data.bbox.dimensions.y).toBeCloseTo(40, 6);
    expect(result.data.bbox.dimensions.z).toBeCloseTo(1.6, 6);
    expect(result.data.bbox.center.z).toBeCloseTo(0.8, 6);
    const expectedVolume = (60 * 40 - (4 - Math.PI) * 3 ** 2 - Math.PI * 1.6 ** 2) * 1.6;
    expect(result.data.volumeMm3).toBeCloseTo(expectedVolume, 4);
    expect(result.data.step.subarray(0, 100).toString()).toContain("ISO-10303-21");
    expect(result.data.stl.byteLength).toBeGreaterThan(84);
  },
  130_000,
);
