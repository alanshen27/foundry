import { describe, expect, it } from "vitest";
import type { CircuitDoc } from "@/lib/circuit/catalog";
import { normalizePcbDoc, type PcbDoc } from "@/lib/pcb/doc";
import { buildRatsnest, padNetMap } from "@/lib/pcb/netlist";
import { buildCopperGraph, padKey, zoneAt } from "@/lib/pcb/routing";
import { pointInPolygon, polygonDepth } from "@/lib/pcb/geometry";
import { runDrc } from "@/lib/pcb/drc";
import { gerberCopper, gerberMask, gerberPaste } from "@/lib/pcb/export";

// Raw shape rather than Partial<PcbDoc>: fixtures go through normalizePcbDoc.
function board(extra: Record<string, unknown> = {}): PcbDoc {
  return normalizePcbDoc({
    board: { widthMm: 40, heightMm: 30, thicknessMm: 1.6, cornerRadiusMm: 0 },
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
        xMm: 25,
        yMm: 10,
        rotationDeg: 0,
        side: "front",
        partId: "r2",
      },
    ],
    ...extra,
  });
}

/** R1.1 and R2.2 both to GND; R1.2-R2.1 is a separate signal net. */
function gndCircuit(): CircuitDoc {
  return {
    version: 2,
    parts: [
      { id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
      { id: "r1", type: "wokwi-resistor", label: "R1", x: 100, y: 0 },
      { id: "r2", type: "wokwi-resistor", label: "R2", x: 200, y: 0 },
    ],
    wires: [
      { id: "w1", from: { part: "uno", pin: "GND.1" }, to: { part: "r1", pin: "1" } },
      { id: "w2", from: { part: "uno", pin: "GND.1" }, to: { part: "r2", pin: "2" } },
      { id: "w3", from: { part: "r1", pin: "2" }, to: { part: "r2", pin: "1" } },
    ],
    groups: [],
  };
}

/** A pour covering the whole board. */
const FULL_POUR = {
  id: "z1",
  net: "GND",
  layer: "F.Cu",
  points: [
    { xMm: 1, yMm: 1 },
    { xMm: 39, yMm: 1 },
    { xMm: 39, yMm: 29 },
    { xMm: 1, yMm: 29 },
  ],
};

describe("normalizePcbDoc — zones", () => {
  it("defaults zones on a legacy document", () => {
    expect(normalizePcbDoc({ board: { widthMm: 20, heightMm: 20 } }).zones).toEqual([]);
  });

  it("drops an outline with fewer than three points", () => {
    const doc = board({
      zones: [
        {
          id: "z",
          layer: "F.Cu",
          points: [
            { xMm: 1, yMm: 1 },
            { xMm: 5, yMm: 5 },
          ],
        },
      ],
    });
    expect(doc.zones).toHaveLength(0);
  });

  it("keeps a valid pour and its net", () => {
    const doc = board({ zones: [FULL_POUR] });
    expect(doc.zones).toHaveLength(1);
    expect(doc.zones[0]!.net).toBe("GND");
    expect(doc.zones[0]!.layer).toBe("F.Cu");
  });
});

describe("geometry — polygons", () => {
  const square = [
    { xMm: 0, yMm: 0 },
    { xMm: 10, yMm: 0 },
    { xMm: 10, yMm: 10 },
    { xMm: 0, yMm: 10 },
  ];

  it("detects inside and outside", () => {
    expect(pointInPolygon(square, 5, 5)).toBe(true);
    expect(pointInPolygon(square, 15, 5)).toBe(false);
    expect(pointInPolygon(square, -1, -1)).toBe(false);
  });

  it("reports depth as positive inside and negative outside", () => {
    expect(polygonDepth(square, 5, 5)).toBeCloseTo(5, 6);
    expect(polygonDepth(square, 1, 5)).toBeCloseTo(1, 6);
    expect(polygonDepth(square, -2, 5)).toBeCloseTo(-2, 6);
  });

  it("handles a concave outline", () => {
    // An L shape: the notch must read as outside.
    const l = [
      { xMm: 0, yMm: 0 },
      { xMm: 10, yMm: 0 },
      { xMm: 10, yMm: 4 },
      { xMm: 4, yMm: 4 },
      { xMm: 4, yMm: 10 },
      { xMm: 0, yMm: 10 },
    ];
    expect(pointInPolygon(l, 2, 2)).toBe(true);
    expect(pointInPolygon(l, 8, 8)).toBe(false);
  });
});

describe("zone connectivity", () => {
  it("connects same-net pads through the pour", () => {
    const doc = board({ zones: [FULL_POUR] });
    const graph = buildCopperGraph(doc, padNetMap(gndCircuit(), doc));
    // R1.1 and R2.2 are both GND and both sit inside the pour.
    expect(graph.set.connected(padKey("f1", "1"), padKey("f2", "2"))).toBe(true);
  });

  it("leaves foreign-net pads out of the pour", () => {
    const doc = board({ zones: [FULL_POUR] });
    const graph = buildCopperGraph(doc, padNetMap(gndCircuit(), doc));
    // R1.2 is on the signal net, so the pour clears around it.
    expect(graph.set.connected(padKey("f1", "1"), padKey("f1", "2"))).toBe(false);
  });

  it("contributes nothing without a net", () => {
    const doc = board({ zones: [{ ...FULL_POUR, net: undefined }] });
    const graph = buildCopperGraph(doc, padNetMap(gndCircuit(), doc));
    expect(graph.set.connected(padKey("f1", "1"), padKey("f2", "2"))).toBe(false);
  });

  it("ignores a pad on the opposite layer", () => {
    const doc = board({ zones: [{ ...FULL_POUR, layer: "B.Cu" }] });
    const graph = buildCopperGraph(doc, padNetMap(gndCircuit(), doc));
    // Front-side SMD pads never reach a B.Cu pour.
    expect(graph.set.connected(padKey("f1", "1"), padKey("f2", "2"))).toBe(false);
  });

  it("does not claim a pad sitting in the pour's clearance margin", () => {
    // Outline hugging R1.1 so the pad is inside but not by the clearance.
    const doc = board({
      zones: [
        {
          id: "z2",
          net: "GND",
          layer: "F.Cu",
          points: [
            { xMm: 9.2, yMm: 9.9 },
            { xMm: 30, yMm: 9.9 },
            { xMm: 30, yMm: 12 },
            { xMm: 9.2, yMm: 12 },
          ],
        },
      ],
    });
    const graph = buildCopperGraph(doc, padNetMap(gndCircuit(), doc));
    expect(graph.set.connected(padKey("f1", "1"), padKey("f2", "2"))).toBe(false);
  });

  it("removes the airwire once the pour joins the net", () => {
    const before = buildRatsnest(gndCircuit(), board());
    const after = buildRatsnest(gndCircuit(), board({ zones: [FULL_POUR] }));
    expect(after.routedCount).toBeGreaterThan(before.routedCount);
  });

  it("finds a zone under the cursor", () => {
    const doc = board({ zones: [FULL_POUR] });
    expect(zoneAt(doc.zones, 20, 15, "F.Cu")?.id).toBe("z1");
    expect(zoneAt(doc.zones, 20, 15, "B.Cu")).toBeNull();
    expect(zoneAt(doc.zones, 0.5, 0.5, "F.Cu")).toBeNull();
  });
});

describe("zone DRC", () => {
  const check = (doc: PcbDoc) => runDrc(doc, buildRatsnest(gndCircuit(), doc));

  it("warns about a pour with no net", () => {
    const rules = check(board({ zones: [{ ...FULL_POUR, net: undefined }] })).violations.map(
      (v) => v.rule,
    );
    expect(rules).toContain("zone-no-net");
  });

  it("warns when the pour spills past the outline", () => {
    const doc = board({
      zones: [
        {
          ...FULL_POUR,
          points: [
            { xMm: -5, yMm: 1 },
            { xMm: 39, yMm: 1 },
            { xMm: 39, yMm: 29 },
            { xMm: -5, yMm: 29 },
          ],
        },
      ],
    });
    expect(check(doc).violations.map((v) => v.rule)).toContain("zone-off-board");
  });

  it("does not call a track dangling when it ends in its own pour", () => {
    const doc = board({
      zones: [FULL_POUR],
      tracks: [
        {
          id: "t1",
          net: "GND",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 9.25, yMm: 10 },
            { xMm: 15, yMm: 20 },
          ],
        },
      ],
    });
    expect(check(doc).violations.map((v) => v.rule)).not.toContain("dangling-track");
  });
});

describe("fabrication output", () => {
  it("pours with dark fill then clear knockouts", () => {
    const g = gerberCopper(
      board({ zones: [FULL_POUR] }),
      "F.Cu",
      padNetMap(gndCircuit(), board({ zones: [FULL_POUR] })),
    );
    expect(g).toContain("%LPD*%");
    expect(g).toContain("%LPC*%");
    // The clear section must come after the pour is laid down.
    expect(g.indexOf("%LPC*%")).toBeGreaterThan(g.indexOf("G36*"));
  });

  it("keeps a B.Cu pour off the front layer", () => {
    const doc = board({ zones: [{ ...FULL_POUR, layer: "B.Cu" }] });
    expect(gerberCopper(doc, "F.Cu")).not.toContain("%LPC*%");
    expect(gerberCopper(doc, "B.Cu")).toContain("%LPC*%");
  });

  it("opens the mask over pads", () => {
    const g = gerberMask(board(), "F.Cu");
    expect(g).toContain("G36*");
    expect(g.trimEnd().endsWith("M02*")).toBe(true);
  });

  it("excludes through-hole pads from the paste stencil", () => {
    const smd = gerberPaste(board(), "F.Cu");
    const tht = gerberPaste(
      normalizePcbDoc({
        board: { widthMm: 40, heightMm: 30 },
        footprints: [
          {
            id: "j1",
            libraryId: "PinHeader_1x04",
            refDes: "J1",
            xMm: 10,
            yMm: 10,
            rotationDeg: 0,
            side: "front",
          },
        ],
      }),
      "F.Cu",
    );
    expect(smd).toContain("G36*");
    // A header is all plated pads, so its stencil has no apertures at all.
    expect(tht).not.toContain("G36*");
  });
});
