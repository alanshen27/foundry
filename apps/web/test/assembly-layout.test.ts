import { describe, expect, it } from "vitest";
import {
  planAssemblyPlacements,
  renderAssemblyKcl,
  seedAssemblyKcl,
  seedAssemblyPreviewKcl,
  defaultAssemblyIteratePrompt,
  ASSEMBLY_LAYOUT_GAP_MM,
} from "@foundry/cad";
import { pcbPartKcl } from "@/lib/pcb/kcl";
import { EMPTY_PCB } from "@/lib/pcb/doc";

describe("seedAssemblyKcl", () => {
  it("imports parts as …/main.kcl with no invented poses", () => {
    const kcl = seedAssemblyKcl([
      { name: "shell", path: "parts/shell.kcl" },
      { name: "pcb", path: "parts/pcb/main.kcl" },
    ]);
    expect(kcl).toContain('import "parts/shell/main.kcl" as shell');
    expect(kcl).toContain('import "parts/pcb/main.kcl" as pcb');
    expect(kcl).toMatch(/^shell$/m);
    expect(kcl).toMatch(/^pcb$/m);
    expect(kcl).not.toContain("translate(");
    expect(kcl).not.toContain("rotate(");
  });
});

describe("seedAssemblyPreviewKcl", () => {
  it("lists manufacturing refs without import scaffolding", () => {
    const kcl = seedAssemblyPreviewKcl([
      { name: "shell", path: "parts/shell.kcl" },
      { name: "lid", path: "parts/lid/main.kcl" },
    ]);
    expect(kcl).toContain("PREVIEW");
    expect(kcl).toContain('solid "shell"');
    expect(kcl).toContain("parts/shell/main.kcl");
    expect(kcl).not.toContain("import ");
  });
});

describe("defaultAssemblyIteratePrompt", () => {
  it("asks for a preview from manufacturing references", () => {
    const prompt = defaultAssemblyIteratePrompt(["parts/shell.kcl", "parts/lid.kcl"]);
    expect(prompt).toContain("parts/shell/main.kcl");
    expect(prompt).toContain("parts/lid/main.kcl");
    expect(prompt.toLowerCase()).toContain("preview");
    expect(prompt.toLowerCase()).toContain("manufacturing");
    expect(prompt.toLowerCase()).not.toContain("reuse the part modules");
  });
});

describe("planAssemblyPlacements", () => {
  it("spaces parts along +X using bbox widths", () => {
    const parts = [
      {
        component: { id: "1", name: "a", path: "parts/a.kcl", kind: "part" as const, content: "" },
        bbox: { center: { x: 0, y: 0, z: 5 }, dimensions: { x: 10, y: 10, z: 10 } },
      },
      {
        component: { id: "2", name: "b", path: "parts/b.kcl", kind: "part" as const, content: "" },
        bbox: { center: { x: 0, y: 0, z: 5 }, dimensions: { x: 20, y: 8, z: 10 } },
      },
    ];
    const plan = planAssemblyPlacements(parts);
    expect(plan).toHaveLength(2);
    expect(plan[0]!.translate.x).toBe(5);
    expect(plan[1]!.translate.x).toBe(10 + ASSEMBLY_LAYOUT_GAP_MM + 10);
  });
});

describe("renderAssemblyKcl", () => {
  it("emits imports and translate pipes", () => {
    const kcl = renderAssemblyKcl([
      {
        path: "parts/shell.kcl",
        alias: "shell",
        translate: { x: 0, y: 0, z: 0 },
        rotate: { roll: 0, pitch: 0, yaw: 0 },
        bbox: { center: { x: 0, y: 0, z: 0 }, dimensions: { x: 1, y: 1, z: 1 } },
      },
      {
        path: "parts/pcb.kcl",
        alias: "pcb",
        translate: { x: 30, y: 0, z: 2 },
        rotate: { roll: 0, pitch: 0, yaw: 0 },
        bbox: { center: { x: 0, y: 0, z: 0 }, dimensions: { x: 1, y: 1, z: 1 } },
      },
    ]);
    expect(kcl).toContain('import "parts/shell/main.kcl" as shell');
    expect(kcl).toContain('import "parts/pcb/main.kcl" as pcb');
    expect(kcl).toMatch(/^shell$/m);
    expect(kcl).toContain("pcb");
    expect(kcl).toContain("translate(pcb, x = 30, y = 0, z = 2)");
    expect(kcl).not.toContain("|> translate");
  });
});

describe("pcbPartKcl", () => {
  it("exposes board dims as visual CAD params and returns one solid", () => {
    const kcl = pcbPartKcl(EMPTY_PCB);
    expect(kcl).toContain("width = 80");
    expect(kcl).toContain("depth = 50");
    expect(kcl).toContain("thickness = 1.6");
    expect(kcl).toContain("board = extrude(");
    expect(kcl.trim().endsWith("board")).toBe(true);
    expect(kcl).not.toContain("fp0");
  });
});
