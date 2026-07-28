import { describe, expect, it } from "vitest";
import { cadDoc, insertPartIntoAssembly, upsertPartScript, type CadDoc } from "@/lib/cad/engine";
import { buildFinalAssembly, FINAL_ASSEMBLY_PATH } from "@/lib/cad/final-assembly";
import { pcbAssemblyKcl } from "@/lib/pcb/kcl";
import { EMPTY_PCB, type PcbDoc } from "@/lib/pcb/doc";

const PART_KCL = `w = 10
s = startSketchOn(XY)
p = startProfile(s, at = [0, 0])
  |> line(end = [w, 0])
  |> line(end = [0, w])
  |> line(end = [-w, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
body = extrude(p, length = 4)
`;

/** A doc with a single standalone part and no assembly component. */
function docWithPart(): CadDoc {
  const doc = upsertPartScript(cadDoc(""), "housing", PART_KCL);
  return {
    ...doc,
    components: doc.components.filter((c) => c.kind !== "assembly" && c.name !== "main"),
  };
}

const pcbWithFootprint: PcbDoc = {
  ...EMPTY_PCB,
  board: { ...EMPTY_PCB.board },
  footprints: [
    {
      id: "fp1",
      libraryId: "R_0603",
      refDes: "R1",
      xMm: 10,
      yMm: 10,
      rotationDeg: 0,
      side: "front",
    },
  ],
};

describe("pcbAssemblyKcl", () => {
  it("draws the board slab with the doc's dimensions", () => {
    const kcl = pcbAssemblyKcl(EMPTY_PCB);
    expect(kcl).toContain("SIMULATED PCB");
    expect(kcl).toContain("fpcbBoard = extrude(fpcbBoardProfile, length = 1.6)");
    expect(kcl).toContain("line(end = [80, 0])");
  });

  it("adds a body per known footprint and lifts it above the board", () => {
    const kcl = pcbAssemblyKcl(pcbWithFootprint, { zOffsetMm: 2 });
    expect(kcl).toContain("fpcbFp0 = extrude(");
    expect(kcl).toContain("translate(z = 3.6)");
  });

  it("skips mounting holes and unknown footprints", () => {
    const doc: PcbDoc = {
      ...pcbWithFootprint,
      footprints: [
        { ...pcbWithFootprint.footprints[0]!, libraryId: "MountingHole_M3" },
        { ...pcbWithFootprint.footprints[0]!, id: "fp2", libraryId: "NOT_A_FOOTPRINT" },
      ],
    };
    expect(pcbAssemblyKcl(doc)).not.toContain("Fp0");
  });
});

describe("buildFinalAssembly", () => {
  it("returns null when there is nothing to show", () => {
    expect(buildFinalAssembly(null, null)).toBeNull();
  });

  it("renders the stock assembly envelope of a fresh doc", () => {
    const out = buildFinalAssembly(cadDoc(""), null);
    expect(out).not.toBeNull();
    expect(out!.script).toContain('import "assembly/');
  });

  it("imports the assembly module and includes the PCB inline", () => {
    const out = buildFinalAssembly(docWithPart(), pcbWithFootprint);
    expect(out).not.toBeNull();
    expect(out!.entryPath).toBe(FINAL_ASSEMBLY_PATH);
    // No assembly component → falls back to the standalone part.
    expect(out!.script).toContain('import "parts/housing/main.kcl" as fa0_housing');
    expect(out!.script).toContain("fpcbBoard");
    expect(out!.projectFiles["parts/housing/main.kcl"]).toContain("body = extrude");
    expect(out!.projectFiles[FINAL_ASSEMBLY_PATH]).toBe(out!.script);
    expect(out!.mechanicalRoots).toEqual(["housing"]);
    expect(out!.mechanicalRootIds).toHaveLength(1);
    expect(out!.hasPcb).toBe(true);
  });

  it("renders via the product assembly but lists every part for open-in-editor", () => {
    const base = upsertPartScript(cadDoc(""), "housing", PART_KCL);
    const withKnob = upsertPartScript(base, "knob", PART_KCL);
    const assembly = withKnob.components.find((c) => c.kind === "assembly")!;
    const housing = withKnob.components.find((c) => c.name === "housing")!;
    const doc = insertPartIntoAssembly(withKnob, assembly.id, housing.id);
    const out = buildFinalAssembly(doc, null);
    expect(out).not.toBeNull();
    expect(out!.script).toContain('import "assembly/');
    expect(out!.script).not.toContain('import "parts/housing.kcl"');
    expect(out!.mechanicalRoots).toEqual(expect.arrayContaining(["housing", "knob", "main"]));
    expect(out!.mechanicalRootIds).toHaveLength(out!.mechanicalRoots.length);
    expect(out!.hasPcb).toBe(false);
  });

  it("renders PCB-only projects without any mechanical imports", () => {
    const out = buildFinalAssembly(null, EMPTY_PCB);
    expect(out).not.toBeNull();
    expect(out!.mechanicalRoots).toEqual([]);
    expect(out!.script).not.toContain("import ");
    expect(out!.script).toContain("fpcbBoard");
  });
});
