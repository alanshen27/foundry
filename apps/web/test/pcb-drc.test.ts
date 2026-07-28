import { describe, expect, it } from "vitest";
import type { CircuitDoc } from "@/lib/circuit/catalog";
import { normalizePcbDoc, type PcbDoc } from "@/lib/pcb/doc";
import { buildRatsnest } from "@/lib/pcb/netlist";
import { runDrc, type DrcViolation } from "@/lib/pcb/drc";

function circuit(partial: Partial<CircuitDoc> = {}): CircuitDoc {
  return { version: 2, parts: [], wires: [], groups: [], ...partial };
}

/** R1.1 on the 5V rail, R1.2 tied to R2.1 — two distinct nets on one part. */
function twoNetCircuit(): CircuitDoc {
  return circuit({
    parts: [
      { id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
      { id: "r1", type: "wokwi-resistor", label: "R1", x: 200, y: 0 },
      { id: "r2", type: "wokwi-resistor", label: "R2", x: 400, y: 0 },
    ],
    wires: [
      { id: "w1", from: { part: "uno", pin: "5V" }, to: { part: "r1", pin: "1" } },
      { id: "w2", from: { part: "r1", pin: "2" }, to: { part: "r2", pin: "1" } },
    ],
  });
}

// Raw shape rather than Partial<PcbDoc>: these fixtures go through
// normalizePcbDoc, which accepts unknown input by design.
function board(extra: Record<string, unknown> = {}): PcbDoc {
  return normalizePcbDoc({
    board: { widthMm: 80, heightMm: 50, thicknessMm: 1.6, cornerRadiusMm: 1 },
    footprints: [
      {
        id: "f1",
        libraryId: "R_0603",
        refDes: "R1",
        xMm: 10,
        yMm: 10,
        rotationDeg: 0,
        side: "front",
        partId: "r1",
      },
      {
        id: "f2",
        libraryId: "R_0603",
        refDes: "R2",
        xMm: 20,
        yMm: 10,
        rotationDeg: 0,
        side: "front",
        partId: "r2",
      },
    ],
    ...extra,
  });
}

function check(doc: PcbDoc, c: CircuitDoc = twoNetCircuit()) {
  return runDrc(doc, buildRatsnest(c, doc));
}

const rules = (v: DrcViolation[]) => v.map((x) => x.rule);

describe("runDrc — shorts", () => {
  it("flags copper bridging two nets", () => {
    // R1 pad 1 (x=9.25) to R1 pad 2 (x=10.75) ties 5V to the R1-R2 net.
    const doc = board({
      tracks: [
        {
          id: "short",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 9.25, yMm: 10 },
            { xMm: 10.75, yMm: 10 },
          ],
        },
      ],
    });
    const result = check(doc);
    const short = result.violations.find((v) => v.rule === "short");
    expect(short).toBeTruthy();
    expect(short!.severity).toBe("error");
    expect(short!.message).toContain("5V");
  });

  it("does not flag correctly routed copper as a short", () => {
    // R1.2 to R2.1 is one net, so joining them is the intended connection.
    const doc = board({
      tracks: [
        {
          id: "ok",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 10.75, yMm: 10 },
            { xMm: 19.25, yMm: 10 },
          ],
        },
      ],
    });
    expect(rules(check(doc).violations)).not.toContain("short");
  });
});

describe("runDrc — clearance", () => {
  it("flags two unconnected tracks closer than the rule", () => {
    const doc = board({
      rules: {
        clearanceMm: 0.2,
        trackWidthMm: 0.25,
        viaDiameterMm: 0.6,
        viaDrillMm: 0.3,
        edgeClearanceMm: 0.3,
      },
      tracks: [
        {
          id: "a",
          layer: "F.Cu",
          widthMm: 0.2,
          points: [
            { xMm: 30, yMm: 20 },
            { xMm: 40, yMm: 20 },
          ],
        },
        // Centre lines 0.3 mm apart, minus two 0.1 mm half-widths = 0.1 mm gap.
        {
          id: "b",
          layer: "F.Cu",
          widthMm: 0.2,
          points: [
            { xMm: 30, yMm: 20.3 },
            { xMm: 40, yMm: 20.3 },
          ],
        },
      ],
    });
    expect(rules(check(doc).violations)).toContain("clearance");
  });

  it("passes when the gap meets the rule", () => {
    const doc = board({
      tracks: [
        {
          id: "a",
          layer: "F.Cu",
          widthMm: 0.2,
          points: [
            { xMm: 30, yMm: 20 },
            { xMm: 40, yMm: 20 },
          ],
        },
        {
          id: "b",
          layer: "F.Cu",
          widthMm: 0.2,
          points: [
            { xMm: 30, yMm: 21 },
            { xMm: 40, yMm: 21 },
          ],
        },
      ],
    });
    expect(rules(check(doc).violations)).not.toContain("clearance");
  });

  it("ignores tracks on opposite layers", () => {
    const doc = board({
      tracks: [
        {
          id: "a",
          layer: "F.Cu",
          widthMm: 0.2,
          points: [
            { xMm: 30, yMm: 20 },
            { xMm: 40, yMm: 20 },
          ],
        },
        {
          id: "b",
          layer: "B.Cu",
          widthMm: 0.2,
          points: [
            { xMm: 30, yMm: 20.05 },
            { xMm: 40, yMm: 20.05 },
          ],
        },
      ],
    });
    expect(rules(check(doc).violations)).not.toContain("clearance");
  });
});

describe("runDrc — board edges", () => {
  it("flags copper outside the outline", () => {
    const doc = board({
      tracks: [
        {
          id: "a",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: -5, yMm: 20 },
            { xMm: 5, yMm: 20 },
          ],
        },
      ],
    });
    expect(rules(check(doc).violations)).toContain("off-board");
  });

  it("warns about copper too near the edge", () => {
    const doc = board({
      tracks: [
        {
          id: "a",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 0.2, yMm: 20 },
            { xMm: 10, yMm: 20 },
          ],
        },
      ],
    });
    const found = check(doc).violations.find((v) => v.rule === "edge-clearance");
    expect(found?.severity).toBe("warning");
  });
});

describe("runDrc — feature sizes", () => {
  it("errors on a via with almost no annular ring", () => {
    const doc = board({
      vias: [{ id: "v", xMm: 30, yMm: 30, diameterMm: 0.6, drillMm: 0.55 }],
    });
    expect(rules(check(doc).violations)).toContain("annular-ring");
  });

  it("warns on a track thinner than the rule", () => {
    const doc = board({
      tracks: [
        {
          id: "a",
          layer: "F.Cu",
          widthMm: 0.1,
          points: [
            { xMm: 30, yMm: 30 },
            { xMm: 40, yMm: 30 },
          ],
        },
      ],
    });
    const found = check(doc).violations.find((v) => v.rule === "track-width");
    expect(found?.severity).toBe("warning");
  });
});

describe("runDrc — connectivity", () => {
  it("reports the unrouted count while airwires remain", () => {
    const found = check(board()).violations.find((v) => v.rule === "unrouted");
    expect(found).toBeTruthy();
    expect(found!.severity).toBe("error");
  });

  it("stops reporting unrouted once the net is joined", () => {
    // Only the R1.2-R2.1 net has two placed pads, so one track routes the board.
    const doc = board({
      tracks: [
        {
          id: "ok",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 10.75, yMm: 10 },
            { xMm: 19.25, yMm: 10 },
          ],
        },
      ],
    });
    expect(rules(check(doc).violations)).not.toContain("unrouted");
  });

  it("warns about a track end connected to nothing", () => {
    const doc = board({
      tracks: [
        {
          id: "a",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 30, yMm: 30 },
            { xMm: 40, yMm: 30 },
          ],
        },
      ],
    });
    const dangling = check(doc).violations.filter((v) => v.rule === "dangling-track");
    // Both ends float, so both are reported.
    expect(dangling).toHaveLength(2);
  });

  it("does not call a pad-terminated track dangling", () => {
    const doc = board({
      tracks: [
        {
          id: "ok",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 10.75, yMm: 10 },
            { xMm: 19.25, yMm: 10 },
          ],
        },
      ],
    });
    expect(rules(check(doc).violations)).not.toContain("dangling-track");
  });
});

describe("runDrc — placement", () => {
  it("warns when two footprints overlap", () => {
    const doc = normalizePcbDoc({
      board: { widthMm: 80, heightMm: 50 },
      footprints: [
        {
          id: "f1",
          libraryId: "SOIC-8",
          refDes: "U1",
          xMm: 20,
          yMm: 20,
          rotationDeg: 0,
          side: "front",
        },
        {
          id: "f2",
          libraryId: "SOIC-8",
          refDes: "U2",
          xMm: 21,
          yMm: 20,
          rotationDeg: 0,
          side: "front",
        },
      ],
    });
    expect(rules(check(doc, circuit()).violations)).toContain("courtyard-overlap");
  });

  it("allows overlap when the parts are on opposite sides", () => {
    const doc = normalizePcbDoc({
      board: { widthMm: 80, heightMm: 50 },
      footprints: [
        {
          id: "f1",
          libraryId: "SOIC-8",
          refDes: "U1",
          xMm: 20,
          yMm: 20,
          rotationDeg: 0,
          side: "front",
        },
        {
          id: "f2",
          libraryId: "SOIC-8",
          refDes: "U2",
          xMm: 21,
          yMm: 20,
          rotationDeg: 0,
          side: "back",
        },
      ],
    });
    expect(rules(check(doc, circuit()).violations)).not.toContain("courtyard-overlap");
  });

  it("counts errors and warnings separately", () => {
    const result = check(board());
    expect(result.errorCount + result.warningCount).toBe(result.violations.length);
  });
});
