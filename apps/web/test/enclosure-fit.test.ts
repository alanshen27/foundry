/**
 * The board-in-enclosure check, against real KCL parameter headers and the
 * real footprint library. Each clean case has a defect case beside it: a fit
 * check that never fails is indistinguishable from one that does not run.
 */

import { describe, expect, it } from "vitest";
import {
  checkEnclosureFit,
  enclosureCandidates,
  MIN_SIDE_CLEARANCE_MM,
  resolveCavity,
} from "@/lib/integration/enclosure-fit";
import { evaluateFit } from "@/lib/integration/fit-check";
import { EMPTY_PCB, type PcbFootprint, type PcbSet } from "@/lib/pcb/doc";

const shell = (header: string) => `${header}\n\nshell = startSketchOn(XY)\n`;

const enclosure = (header: string) => ({
  path: "parts/enclosure/main.kcl",
  name: "enclosure",
  kind: "part",
  content: shell(header),
});

function board(
  widthMm: number,
  heightMm: number,
  footprints: Partial<PcbFootprint>[] = [],
  thicknessMm = 1.6,
): PcbSet {
  return {
    version: 2,
    boards: [
      {
        ...EMPTY_PCB,
        id: "board-1",
        name: "Main board",
        board: { ...EMPTY_PCB.board, widthMm, heightMm, thicknessMm },
        footprints: footprints.map((f, i) => ({
          id: `fp${i}`,
          libraryId: "R_0603",
          refDes: `R${i + 1}`,
          xMm: 5,
          yMm: 5,
          rotationDeg: 0,
          side: "front" as const,
          ...f,
        })),
      },
    ],
  };
}

const errors = <T extends { severity: string }>(f: T[]) => f.filter((x) => x.severity === "error");

describe("resolveCavity", () => {
  it("uses explicit inner dimensions directly", () => {
    const r = resolveCavity(shell("inner_width = 70\ninner_length = 50\ninner_height = 20"));
    expect(r).toMatchObject({ ok: true, cavity: { x: 70, y: 50, z: 20 } });
  });

  it("subtracts the walls from outer dimensions, and only the floor from the height", () => {
    const r = resolveCavity(shell("width = 90\nlength = 60\nheight = 30\nwall_thickness = 2"));
    // Open-topped shell: 2 mm off each side, 2 mm floor, lid is its own part.
    expect(r).toMatchObject({ ok: true, cavity: { x: 86, y: 56, z: 28 } });
  });

  it("uses a separate floor thickness when one is declared", () => {
    const r = resolveCavity(
      shell("width = 90\nlength = 60\nheight = 30\nwall_thickness = 2\nfloor_thickness = 4"),
    );
    expect(r).toMatchObject({ ok: true, cavity: { z: 26 } });
  });

  it("refuses to assume a zero wall when none is declared", () => {
    const r = resolveCavity(shell("width = 90\nlength = 60\nheight = 30"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("no wall thickness");
  });

  it("converts from the file's declared length unit, where Zoo puts it: first", () => {
    const r = resolveCavity(
      shell("@settings(defaultLengthUnit = in)\ninner_width = 2\ninner_length = 1"),
    );
    expect(r).toMatchObject({ ok: true, cavity: { x: 50.8, y: 25.4 } });
  });

  it("reads Zoo-style camelCase names with an object prefix", () => {
    const r = resolveCavity(
      shell(
        "@settings(defaultLengthUnit = mm, kclVersion = 1.0)\ncaseWidth = 104\ncaseLength = 70\ncaseHeight = 20\nwallThickness = 2",
      ),
    );
    expect(r).toMatchObject({ ok: true, cavity: { x: 100, y: 66, z: 18 } });
  });

  it("treats depth as the length when height is given, and as the height when length is", () => {
    expect(
      resolveCavity(shell("inner_width = 70\ninner_depth = 40\ninner_height = 20")),
    ).toMatchObject({
      ok: true,
      cavity: { y: 40, z: 20 },
    });
    expect(
      resolveCavity(shell("inner_width = 70\ninner_length = 40\ninner_depth = 20")),
    ).toMatchObject({
      ok: true,
      cavity: { y: 40, z: 20 },
    });
  });

  it("reads a declared standoff", () => {
    expect(
      resolveCavity(shell("inner_width = 70\ninner_length = 50\nstandoff_height = 4")),
    ).toMatchObject({
      ok: true,
      cavity: { standoff: 4 },
    });
  });
});

describe("enclosureCandidates", () => {
  it("picks enclosure-like parts and ignores lids, bays and brackets", () => {
    const names = enclosureCandidates([
      { path: "parts/enclosure/main.kcl", name: "enclosure", kind: "part", content: "x = 1" },
      { path: "parts/lid/main.kcl", name: "lid", kind: "part", content: "x = 1" },
      { path: "parts/battery-bay/main.kcl", name: "battery bay", kind: "part", content: "x = 1" },
      { path: "parts/case-bracket/main.kcl", name: "case bracket", kind: "part", content: "x = 1" },
      { path: "assembly/product.kcl", name: "product", kind: "assembly", content: "x = 1" },
    ]).map((c) => c.name);
    expect(names).toEqual(["enclosure"]);
  });
});

describe("checkEnclosureFit — plan view", () => {
  const box = enclosure("width = 90\nlength = 60\nheight = 30\nwall_thickness = 2");

  it("passes a board with room to spare", () => {
    expect(checkEnclosureFit({ pcb: board(70, 45), cad: [box] })).toEqual([]);
  });

  it("fails a board that is too wide, and says by how much", () => {
    const findings = checkEnclosureFit({ pcb: board(90, 45), cad: [box] });
    expect(errors(findings)).toHaveLength(1);
    expect(findings[0]!.message).toBe(
      "Main board (90 mm × 45 mm) does not fit the 86 mm × 56 mm cavity of parts/enclosure/main.kcl — it is 4 mm too wide, in either orientation.",
    );
    expect(findings[0]!.hint).toContain("COMPUTED from width = 90 mm, length = 60 mm");
    expect(findings[0]!.nodes).toEqual([
      { refKey: "cadpart:parts/enclosure/main.kcl", label: "parts/enclosure/main.kcl" },
    ]);
  });

  it("notices when a board only fits turned 90°", () => {
    const tall = enclosure("inner_width = 50\ninner_length = 80");
    const findings = checkEnclosureFit({ pcb: board(70, 40), cad: [tall] });
    expect(errors(findings)).toHaveLength(0);
    expect(findings.map((f) => f.message)).toContain(
      "Main board only fits parts/enclosure/main.kcl turned 90°.",
    );
  });

  it("warns when a board fits with too little clearance to close the case", () => {
    const snug = enclosure("inner_width = 70.4\ninner_length = 60");
    const findings = checkEnclosureFit({ pcb: board(70, 45), cad: [snug] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "warning" });
    expect(findings[0]!.message).toContain(`less than the ${MIN_SIDE_CLEARANCE_MM} mm`);
  });
});

describe("checkEnclosureFit — height", () => {
  it("fails a stack taller than the cavity, naming the part responsible", () => {
    // 2 mm default standoff + 1.6 mm board + 8.5 mm header = 12.1 mm into 10 mm.
    const shallow = enclosure("inner_width = 80\ninner_length = 60\ninner_height = 10");
    const findings = checkEnclosureFit({
      pcb: board(70, 45, [{ libraryId: "PinHeader_1x04", refDes: "J1" }]),
      cad: [shallow],
    });
    expect(errors(findings)).toHaveLength(1);
    expect(findings[0]!.message).toBe(
      "The height stack of Main board is ESTIMATED 12.1 mm (2 mm standoff + 1.6 mm board + 8.5 mm J1) but the cavity of parts/enclosure/main.kcl is 10 mm — 2.1 mm short.",
    );
    expect(findings[0]!.nodes?.[0]).toEqual({ refKey: "footprint:0:J1", label: "J1" });
  });

  it("stacks a part's own standoff and known body height", () => {
    // 2 mm standoff + 1.6 mm board + (5 mm module standoff + 3 mm body) = 11.6 mm.
    const shallow = enclosure("inner_width = 80\ninner_length = 60\ninner_height = 11");
    const findings = checkEnclosureFit({
      pcb: board(70, 45, [
        { libraryId: "R_0603", refDes: "DS1", bodyHeightMm: 3, standoffMm: 5 },
        { libraryId: "PinHeader_1x04", refDes: "J1", bodyHeightMm: 2.5 },
      ]),
      cad: [shallow],
    });
    expect(errors(findings)[0]!.message).toContain("ESTIMATED 11.6 mm");
    expect(errors(findings)[0]!.message).toContain("8 mm DS1");
  });

  it("uses the enclosure's own standoff height", () => {
    const withStandoff = enclosure(
      "inner_width = 80\ninner_length = 60\ninner_height = 14\nstandoff_height = 5",
    );
    const findings = checkEnclosureFit({
      pcb: board(70, 45, [{ libraryId: "PinHeader_1x04", refDes: "J1" }]),
      cad: [withStandoff],
    });
    // 5 + 1.6 + 8.5 = 15.1 into 14.
    expect(errors(findings)[0]!.message).toContain("5 mm standoff");
  });

  it("warns when the lid would sit right on the tallest part", () => {
    const tight = enclosure("inner_width = 80\ninner_length = 60\ninner_height = 12.5");
    const findings = checkEnclosureFit({
      pcb: board(70, 45, [{ libraryId: "PinHeader_1x04", refDes: "J1" }]),
      cad: [tight],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "warning" });
    expect(findings[0]!.message).toContain("leaving 0.4 mm under the lid");
  });

  it("fails a back-side part taller than the standoff", () => {
    const box = enclosure("inner_width = 80\ninner_length = 60\ninner_height = 30");
    const findings = checkEnclosureFit({
      pcb: board(70, 45, [{ libraryId: "USB_C_Receptacle", refDes: "J2", side: "back" }]),
      cad: [box],
    });
    expect(errors(findings)[0]!.message).toBe(
      "J2 on the back of Main board stands ESTIMATED 3.3 mm tall, but the board sits only 2 mm above the enclosure floor.",
    );
  });

  it("says when some part heights are unknown, instead of passing silently", () => {
    const box = enclosure("inner_width = 80\ninner_length = 60\ninner_height = 30");
    const findings = checkEnclosureFit({
      pcb: board(70, 45, [{ libraryId: "Mystery_Package" }]),
      cad: [box],
    });
    expect(findings).toEqual([
      expect.objectContaining({
        severity: "info",
        message: expect.stringContaining("no known height"),
      }),
    ]);
  });
});

describe("checkEnclosureFit — when it cannot tell", () => {
  it("reports the missing parameters rather than claiming a fit", () => {
    const findings = checkEnclosureFit({
      pcb: board(70, 45),
      cad: [enclosure("width = 90\nlength = 60\nheight = 30")],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "info" });
    expect(findings[0]!.message).toContain("Could not check whether the board fits");
    expect(findings[0]!.hint).toContain("wall_thickness");
  });

  it("stays silent with no board or no enclosure to compare", () => {
    expect(
      checkEnclosureFit({ pcb: null, cad: [enclosure("inner_width = 1\ninner_length = 1")] }),
    ).toEqual([]);
    expect(checkEnclosureFit({ pcb: board(70, 45), cad: [] })).toEqual([]);
  });

  it("checks against the largest resolvable cavity when several parts qualify", () => {
    const outer = {
      ...enclosure("inner_width = 100\ninner_length = 80"),
      path: "parts/case/main.kcl",
      name: "case",
    };
    const inner = {
      ...enclosure("inner_width = 60\ninner_length = 40"),
      path: "parts/inner-shell/main.kcl",
      name: "inner shell",
    };
    expect(errors(checkEnclosureFit({ pcb: board(70, 45), cad: [inner, outer] }))).toEqual([]);
  });
});

describe("in the integration fit check", () => {
  it("runs even when the project has no schematic yet", () => {
    const report = evaluateFit({
      circuit: null,
      pcb: board(90, 45),
      codeFiles: [],
      components: [],
      cad: [enclosure("width = 90\nlength = 60\nheight = 30\nwall_thickness = 2")],
      requirements: [],
      validationChecks: [],
    });
    expect(report.findings.map((f) => f.domain)).toContain("MECHANICAL");
    // The no-schematic error plus the board that does not fit.
    expect(report.counts.errors).toBe(2);
  });
});
