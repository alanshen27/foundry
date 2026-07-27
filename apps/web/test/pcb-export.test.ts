import { describe, expect, it } from "vitest";
import { normalizePcbDoc, type PcbDoc } from "@/lib/pcb/doc";
import {
  excellonDrill,
  fabricationFiles,
  gerberCopper,
  gerberOutline,
  gerberSilk,
} from "@/lib/pcb/export";

// Raw shape rather than Partial<PcbDoc>: these fixtures go through
// normalizePcbDoc, which accepts unknown input by design.
function board(extra: Record<string, unknown> = {}): PcbDoc {
  return normalizePcbDoc({
    board: { widthMm: 80, heightMm: 50, thicknessMm: 1.6, cornerRadiusMm: 0 },
    footprints: [
      { id: "f1", libraryId: "R_0603", refDes: "R1", xMm: 10, yMm: 10, rotationDeg: 0, side: "front" },
    ],
    ...extra,
  });
}

const track = {
  id: "t1",
  layer: "F.Cu",
  widthMm: 0.25,
  points: [
    { xMm: 10.75, yMm: 10 },
    { xMm: 19.25, yMm: 10 },
  ],
};

describe("gerberCopper", () => {
  it("writes a well-formed RS-274X header and terminator", () => {
    const g = gerberCopper(board({ tracks: [track] }), "F.Cu");
    expect(g).toContain("%FSLAX36Y36*%");
    expect(g).toContain("%MOMM*%");
    expect(g.trimEnd().endsWith("M02*")).toBe(true);
  });

  it("declares one circular aperture per track width", () => {
    const g = gerberCopper(
      board({
        tracks: [
          track,
          { id: "t2", layer: "F.Cu", widthMm: 0.5, points: [{ xMm: 30, yMm: 30 }, { xMm: 40, yMm: 30 }] },
        ],
      }),
      "F.Cu",
    );
    expect(g).toContain("C,0.250000");
    expect(g).toContain("C,0.500000");
  });

  it("flips Y so the board is not mirrored", () => {
    // Board is 50 mm tall, so y=10 must come out at 40 mm in Gerber space.
    const g = gerberCopper(board({ tracks: [track] }), "F.Cu");
    expect(g).toContain("X10750000Y40000000D02*");
    expect(g).toContain("X19250000Y40000000D01*");
  });

  it("strokes a track as a move followed by draws", () => {
    const g = gerberCopper(board({ tracks: [track] }), "F.Cu");
    const moves = g.split("\n").filter((l) => l.endsWith("D02*"));
    const draws = g.split("\n").filter((l) => l.endsWith("D01*"));
    expect(moves.length).toBeGreaterThanOrEqual(1);
    expect(draws.length).toBeGreaterThanOrEqual(1);
  });

  it("emits pads as filled regions rather than flashes", () => {
    const g = gerberCopper(board(), "F.Cu");
    expect(g).toContain("G36*");
    expect(g).toContain("G37*");
  });

  it("keeps a front-side track off the back layer", () => {
    const back = gerberCopper(board({ tracks: [track] }), "B.Cu");
    expect(back).not.toContain("X10750000Y40000000D02*");
  });

  it("flashes vias on both copper layers", () => {
    const doc = board({ vias: [{ id: "v1", xMm: 30, yMm: 20, diameterMm: 0.6, drillMm: 0.3 }] });
    for (const layer of ["F.Cu", "B.Cu"] as const) {
      expect(gerberCopper(doc, layer)).toContain("X30000000Y30000000D03*");
    }
  });

  it("rotates pad outlines with the footprint", () => {
    const straight = gerberCopper(board(), "F.Cu");
    const turned = gerberCopper(
      normalizePcbDoc({
        board: { widthMm: 80, heightMm: 50, cornerRadiusMm: 0 },
        footprints: [
          { id: "f1", libraryId: "R_0603", refDes: "R1", xMm: 10, yMm: 10, rotationDeg: 90, side: "front" },
        ],
      }),
      "F.Cu",
    );
    expect(turned).not.toBe(straight);
  });
});

describe("gerberOutline", () => {
  it("closes the rectangle back to its start", () => {
    const g = gerberOutline(board());
    const draws = g.split("\n").filter((l) => l.endsWith("D01*"));
    expect(draws[draws.length - 1]).toBe("X0Y50000000D01*");
  });

  it("approximates rounded corners with segments", () => {
    const sharp = gerberOutline(board());
    const rounded = gerberOutline(
      normalizePcbDoc({ board: { widthMm: 80, heightMm: 50, cornerRadiusMm: 3 }, footprints: [] }),
    );
    expect(rounded.split("\n").length).toBeGreaterThan(sharp.split("\n").length);
  });
});

describe("gerberSilk", () => {
  it("outlines front-side bodies only", () => {
    const front = gerberSilk(board());
    const backOnly = gerberSilk(
      normalizePcbDoc({
        board: { widthMm: 80, heightMm: 50 },
        footprints: [
          { id: "f1", libraryId: "R_0603", refDes: "R1", xMm: 10, yMm: 10, rotationDeg: 0, side: "back" },
        ],
      }),
    );
    expect(front.split("\n").length).toBeGreaterThan(backOnly.split("\n").length);
  });
});

describe("excellonDrill", () => {
  it("writes the Excellon envelope", () => {
    const d = excellonDrill(board({ vias: [{ id: "v1", xMm: 30, yMm: 20, diameterMm: 0.6, drillMm: 0.3 }] }));
    expect(d.startsWith("M48")).toBe(true);
    expect(d).toContain("METRIC,TZ");
    expect(d.trimEnd().endsWith("M30")).toBe(true);
  });

  it("declares one tool per distinct drill size", () => {
    const d = excellonDrill(
      board({
        vias: [
          { id: "v1", xMm: 30, yMm: 20, diameterMm: 0.6, drillMm: 0.3 },
          { id: "v2", xMm: 35, yMm: 20, diameterMm: 0.6, drillMm: 0.3 },
          { id: "v3", xMm: 40, yMm: 20, diameterMm: 0.9, drillMm: 0.5 },
        ],
      }),
    );
    expect(d).toContain("T1C0.300");
    expect(d).toContain("T2C0.500");
    expect(d).not.toContain("T3C");
  });

  it("includes plated footprint holes", () => {
    // A pin header's pads are plated, so each one needs a drill hit.
    const d = excellonDrill(
      normalizePcbDoc({
        board: { widthMm: 80, heightMm: 50 },
        footprints: [
          { id: "j1", libraryId: "PinHeader_1x04", refDes: "J1", xMm: 10, yMm: 10, rotationDeg: 0, side: "front" },
        ],
      }),
    );
    const hits = d.split("\n").filter((l) => /^X[\d.]+Y[\d.]+$/.test(l));
    expect(hits).toHaveLength(4);
  });

  it("flips Y to match the Gerber layers", () => {
    const d = excellonDrill(board({ vias: [{ id: "v1", xMm: 30, yMm: 20, diameterMm: 0.6, drillMm: 0.3 }] }));
    expect(d).toContain("X30.000Y30.000");
  });
});

describe("fabricationFiles", () => {
  it("returns the full set a fab needs", () => {
    const files = fabricationFiles(board({ tracks: [track] }), "demo");
    expect(files.map((f) => f.name)).toEqual([
      "demo-F_Cu.gbr",
      "demo-B_Cu.gbr",
      "demo-Edge_Cuts.gbr",
      "demo-F_SilkS.gbr",
      "demo.drl",
    ]);
    expect(files.every((f) => f.contents.length > 0)).toBe(true);
  });
});
