import { describe, expect, it } from "vitest";
import { buildLinkedAssembly, cadDoc, stableCadHash, type CadDoc } from "@foundry/cad";
import type { CircuitDoc } from "@/lib/circuit/catalog";
import { normalizePcbSet, type PcbSet } from "@/lib/pcb/doc";
import { pcbMechanicalSourceHash } from "@/lib/pcb/mechanical";
import { buildEngineeringReadiness } from "@/lib/engineering/readiness";
import { ASSEMBLY_TAB, tabFromViewParam } from "@/lib/engineer-tabs";

function fixture() {
  const circuit: CircuitDoc = {
    version: 2,
    groups: [],
    parts: [
      { id: "r1", type: "wokwi-resistor", label: "R1", x: 10, y: 10 },
      { id: "r2", type: "wokwi-resistor", label: "R2", x: 20, y: 10 },
    ],
    wires: [{ id: "w1", from: { part: "r1", pin: "2" }, to: { part: "r2", pin: "1" } }],
  };
  const pcb = normalizePcbSet({
    version: 2,
    boards: [
      {
        id: "main-board",
        name: "Main board",
        board: { widthMm: 80, heightMm: 50, thicknessMm: 1.6, cornerRadiusMm: 0 },
        footprints: [
          {
            id: "fp1",
            libraryId: "R_0603",
            refDes: "R1",
            partId: "r1",
            xMm: 10,
            yMm: 10,
            bodyHeightMm: 0.6,
          },
          {
            id: "fp2",
            libraryId: "R_0603",
            refDes: "R2",
            partId: "r2",
            xMm: 20,
            yMm: 10,
            bodyHeightMm: 0.6,
          },
        ],
        tracks: [
          {
            id: "t1",
            layer: "F.Cu",
            widthMm: 0.25,
            points: [
              { xMm: 10.75, yMm: 10 },
              { xMm: 19.25, yMm: 10 },
            ],
          },
        ],
      },
    ],
  });
  return { circuit, pcb, cad: linkedCad(pcb) };
}

function linkedCad(pcb: PcbSet): CadDoc {
  const base = cadDoc("boardWidth = 80\n");
  const sourcePart = base.components.find((part) => part.kind === "part")!;
  const board = pcb.boards[0]!;
  const updated: CadDoc = {
    ...base,
    components: base.components.map((part) =>
      part.id === sourcePart.id
        ? {
            ...part,
            name: "Main board",
            path: "parts/pcb/main.kcl",
            source: {
              kind: "pcb",
              boardId: board.id!,
              sourceHash: pcbMechanicalSourceHash(board),
              generatedHash: stableCadHash(part.content),
            },
          }
        : part,
    ),
  };
  return buildLinkedAssembly(updated);
}

describe("connected engineering readiness", () => {
  it("keeps absent documents missing rather than treating normalizer starter geometry as work", () => {
    const report = buildEngineeringReadiness({ circuit: null, pcb: null, cad: null });
    expect(report.stages.map((stage) => stage.state)).toEqual([
      "missing",
      "missing",
      "missing",
      "missing",
    ]);
    expect(report.counts.parts).toBe(0);
    expect(report.label).toBe("LOCAL / UNVERIFIED");
  });

  it("recognizes current linked documents without claiming engineering verification", () => {
    const report = buildEngineeringReadiness(fixture());
    expect(report.issues).toEqual([]);
    expect(report.stages.map((stage) => stage.state)).toEqual([
      "current",
      "current",
      "current",
      "current",
    ]);
    expect(JSON.stringify(report)).not.toContain('"PASS"');
    expect(report.label).toBe("LOCAL / UNVERIFIED");
  });

  it("finds unplaced schematic parts even when they have no wires", () => {
    const input = fixture();
    input.circuit.parts.push({ id: "r3", type: "wokwi-resistor", label: "R3", x: 30, y: 10 });
    const report = buildEngineeringReadiness(input);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        id: "pcb:unplaced",
        severity: "error",
        detail: "R3",
        target: { view: "pcb", boardId: "main-board" },
      }),
    );
  });

  it("finds incomplete pin maps and routes independently", () => {
    const input = fixture();
    input.circuit.wires[0]!.from.pin = "A";
    input.pcb.boards[0]!.tracks = [];
    const report = buildEngineeringReadiness(input);
    expect(
      report.issues.some(
        (issue) => issue.id.endsWith(":unmapped") && issue.detail.includes("R1.A"),
      ),
    ).toBe(true);
    input.circuit.wires[0]!.from.pin = "2";
    expect(
      buildEngineeringReadiness(input).issues.some((issue) => issue.id.endsWith(":drc:unrouted")),
    ).toBe(true);
  });

  it("checks every PCB board and catches duplicate identities across boards", () => {
    const input = fixture();
    const second = structuredClone(input.pcb.boards[0]!);
    second.id = "second-board";
    second.name = "Second board";
    second.footprints[0]!.xMm = 100;
    input.pcb.boards.push(second);
    const report = buildEngineeringReadiness(input);
    expect(report.counts.boards).toBe(2);
    expect(report.issues.some((issue) => issue.id === "pcb:duplicate:r1")).toBe(true);
    expect(
      report.issues.some(
        (issue) =>
          issue.id.includes("second-board:drc:off-board") &&
          issue.target.boardId === "second-board",
      ),
    ).toBe(true);
    expect(report.issues.some((issue) => issue.id === "cad:second-board:missing")).toBe(true);
  });

  it("reports broken electrical references", () => {
    const input = fixture();
    input.circuit.wires[0]!.to.part = "removed";
    expect(buildEngineeringReadiness(input).issues).toContainEqual(
      expect.objectContaining({
        id: "erc:missing_part",
        severity: "error",
        target: { view: "schematic" },
      }),
    );
  });

  it("marks CAD and assembly outdated after source board geometry changes", () => {
    const input = fixture();
    input.pcb.boards[0]!.board.widthMm = 90;
    const report = buildEngineeringReadiness(input);
    expect(report.stages.find((stage) => stage.id === "cad")?.state).toBe("outdated");
    expect(report.stages.find((stage) => stage.id === "assembly")?.state).toBe("outdated");
    expect(report.issues.some((issue) => issue.id === "cad:main-board:outdated")).toBe(true);
  });

  it("detects manual changes to generated board geometry and preview source", () => {
    const input = fixture();
    input.cad.components.find((part) => part.kind === "part")!.content += "// edited\n";
    expect(
      buildEngineeringReadiness(input).issues.some((issue) => issue.id === "cad:main-board:edited"),
    ).toBe(true);
    input.cad.components.find((part) => part.kind === "assembly")!.content += "// edited\n";
    expect(
      buildEngineeringReadiness(input).issues.some((issue) => issue.id === "assembly:edited"),
    ).toBe(true);
  });

  it("does not present a legacy preview as a linked assembly", () => {
    const input = fixture();
    delete input.cad.assembly;
    expect(
      buildEngineeringReadiness(input).issues.some((issue) => issue.id === "assembly:missing"),
    ).toBe(true);
  });

  it("warns when a board mockup is still stacked at the origin with other parts", () => {
    const input = fixture();
    input.cad.components.push({
      id: "housing",
      name: "Housing",
      path: "parts/housing/main.py",
      kind: "part",
      content: "from build123d import Box\nresult = Box(80, 50, 12)\n",
    });
    input.cad.assembly!.instances.push({
      id: "instance-housing",
      componentId: "housing",
      translationMm: { x: 0, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      visible: true,
      fixed: false,
    });
    expect(buildEngineeringReadiness(input).issues).toContainEqual(
      expect.objectContaining({
        id: "assembly:pcb-at-origin",
        severity: "warning",
        target: { view: "assembly" },
      }),
    );
  });

  it("reports boards excluded from visible assembly instances", () => {
    const input = fixture();
    input.cad.assembly!.instances[0]!.visible = false;
    expect(
      buildEngineeringReadiness(input).issues.some(
        (issue) => issue.id === "assembly:missing-boards",
      ),
    ).toBe(true);
  });

  it("requires explicit component heights without inventing dimensions", () => {
    const input = fixture();
    delete input.pcb.boards[0]!.footprints[0]!.bodyHeightMm;
    input.cad = linkedCad(input.pcb);
    expect(buildEngineeringReadiness(input).issues).toContainEqual(
      expect.objectContaining({
        id: "cad:main-board:heights",
        severity: "warning",
        target: { view: "pcb", boardId: "main-board" },
      }),
    );
  });

  it("preserves inputs while reporting a removed board's CAD part", () => {
    const input = fixture();
    input.pcb.boards[0]!.id = "replacement-board";
    const before = structuredClone(input);
    expect(
      buildEngineeringReadiness(input).issues.some((issue) =>
        issue.id.startsWith("cad:removed-board:"),
      ),
    ).toBe(true);
    expect(input).toEqual(before);
  });
});

describe("workflow navigation", () => {
  it("opens the Assembly viewport by default", () => {
    expect(tabFromViewParam(undefined)).toEqual(ASSEMBLY_TAB);
  });
  it("retains a requested board identity in the PCB tab", () => {
    expect(tabFromViewParam("pcb", null, "second-board")).toEqual({
      key: "pcb",
      kind: "pcb",
      label: "PCB",
      boardId: "second-board",
    });
    expect(tabFromViewParam("model", "part-id", "second-board")).toMatchObject({
      kind: "model",
      componentId: "part-id",
    });
  });
});
