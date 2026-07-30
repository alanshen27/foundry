import { describe, expect, it } from "vitest";
import type { CircuitDoc } from "@/lib/circuit/catalog";
import { normalizePcbDoc, type PcbDoc } from "@/lib/pcb/doc";
import { buildRatsnest } from "@/lib/pcb/netlist";
import {
  buildCopperGraph,
  padAt,
  route45Points,
  trackAt,
  trackLength,
  viaAt,
  zoneAt,
} from "@/lib/pcb/routing";
import { boardPads, pointPadDistance, segmentSegmentDistance } from "@/lib/pcb/geometry";

function circuit(partial: Partial<CircuitDoc> = {}): CircuitDoc {
  return { version: 2, parts: [], wires: [], groups: [], ...partial };
}

/** R1 and R2 in series, so R1.2 and R2.1 share one net. */
function seriesCircuit(): CircuitDoc {
  return circuit({
    parts: [
      { id: "r1", type: "wokwi-resistor", label: "R1", x: 0, y: 0 },
      { id: "r2", type: "wokwi-resistor", label: "R2", x: 200, y: 0 },
    ],
    wires: [{ id: "w1", from: { part: "r1", pin: "2" }, to: { part: "r2", pin: "1" } }],
  });
}

/**
 * Two 0603 resistors 10 mm apart on the front. R1 pads sit at x=9.25/10.75,
 * R2 pads at x=19.25/20.75 (pad offset is ±0.75 mm), both at y=10.
 */
// Raw shape rather than Partial<PcbDoc>: these fixtures go through
// normalizePcbDoc, and some deliberately carry invalid values to prove it.
function seriesBoard(extra: Record<string, unknown> = {}): PcbDoc {
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

/** A track joining R1 pad 2 (10.75, 10) to R2 pad 1 (19.25, 10). */
const JOINING_TRACK = {
  id: "t1",
  layer: "F.Cu",
  widthMm: 0.25,
  net: "N$1",
  points: [
    { xMm: 10.75, yMm: 10 },
    { xMm: 19.25, yMm: 10 },
  ],
};

describe("guided routing geometry", () => {
  it("creates a horizontal plus 45-degree candidate", () => {
    expect(route45Points({ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 4 })).toEqual([
      { xMm: 0, yMm: 0 },
      { xMm: 6, yMm: 0 },
      { xMm: 10, yMm: 4 },
    ]);
  });

  it("keeps direct horizontal, vertical, and diagonal routes direct", () => {
    expect(route45Points({ xMm: 1, yMm: 2 }, { xMm: 8, yMm: 2 })).toHaveLength(2);
    expect(route45Points({ xMm: 1, yMm: 2 }, { xMm: 1, yMm: 9 })).toHaveLength(2);
    expect(route45Points({ xMm: 1, yMm: 2 }, { xMm: 6, yMm: 7 })).toHaveLength(2);
  });

  it("measures every segment in a track", () => {
    expect(
      trackLength([
        { xMm: 0, yMm: 0 },
        { xMm: 3, yMm: 4 },
        { xMm: 6, yMm: 8 },
      ]),
    ).toBe(10);
  });
});

describe("normalizePcbDoc — copper", () => {
  it("defaults tracks, vias and rules on a legacy document", () => {
    const doc = normalizePcbDoc({ board: { widthMm: 20, heightMm: 20 }, footprints: [] });
    expect(doc.tracks).toEqual([]);
    expect(doc.vias).toEqual([]);
    expect(doc.rules.clearanceMm).toBeGreaterThan(0);
  });

  it("drops a track with fewer than two distinct points", () => {
    const doc = seriesBoard({
      tracks: [
        { id: "a", layer: "F.Cu", widthMm: 0.25, points: [{ xMm: 1, yMm: 1 }] },
        // Duplicate vertices collapse to one point, so this is not copper either.
        {
          id: "b",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 2, yMm: 2 },
            { xMm: 2, yMm: 2 },
          ],
        },
      ],
    });
    expect(doc.tracks).toHaveLength(0);
  });

  it("keeps a via's drill inside its annular ring", () => {
    const doc = seriesBoard({
      vias: [{ id: "v1", xMm: 5, yMm: 5, diameterMm: 0.6, drillMm: 5 }],
    });
    expect(doc.vias[0]!.drillMm).toBeLessThan(doc.vias[0]!.diameterMm);
  });

  it("defaults an unknown layer to F.Cu", () => {
    const doc = seriesBoard({
      tracks: [
        {
          id: "a",
          layer: "In1.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 1, yMm: 1 },
            { xMm: 2, yMm: 2 },
          ],
        },
      ],
    });
    expect(doc.tracks[0]!.layer).toBe("F.Cu");
  });
});

describe("buildCopperGraph", () => {
  it("joins two pads a track lands on", () => {
    const doc = seriesBoard({ tracks: [JOINING_TRACK] });
    const graph = buildCopperGraph(doc);
    const pads = boardPads(doc.footprints);
    const r1p2 = pads.find((p) => p.refDes === "R1" && p.pin === "2")!;
    const r2p1 = pads.find((p) => p.refDes === "R2" && p.pin === "1")!;
    expect(graph.padsConnected(r1p2, r2p1)).toBe(true);
  });

  it("leaves pads unconnected when the track stops short", () => {
    const doc = seriesBoard({
      tracks: [
        {
          ...JOINING_TRACK,
          points: [
            { xMm: 10.75, yMm: 10 },
            { xMm: 15, yMm: 10 },
          ],
        },
      ],
    });
    const graph = buildCopperGraph(doc);
    const pads = boardPads(doc.footprints);
    const r1p2 = pads.find((p) => p.refDes === "R1" && p.pin === "2")!;
    const r2p1 = pads.find((p) => p.refDes === "R2" && p.pin === "1")!;
    expect(graph.padsConnected(r1p2, r2p1)).toBe(false);
  });

  it("does not join pads through a track on the other layer", () => {
    const doc = seriesBoard({ tracks: [{ ...JOINING_TRACK, layer: "B.Cu" }] });
    const graph = buildCopperGraph(doc);
    const pads = boardPads(doc.footprints);
    const r1p2 = pads.find((p) => p.refDes === "R1" && p.pin === "2")!;
    const r2p1 = pads.find((p) => p.refDes === "R2" && p.pin === "1")!;
    expect(graph.padsConnected(r1p2, r2p1)).toBe(false);
  });

  it("bridges layers through vias at both ends", () => {
    // R1/R2 are front-side SMD, so their pads exist only on F.Cu. Dropping to
    // the back and coming up again needs a via at each end of the B.Cu run.
    const doc = seriesBoard({
      tracks: [
        {
          id: "t1",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 10.75, yMm: 10 },
            { xMm: 13, yMm: 10 },
          ],
        },
        {
          id: "t2",
          layer: "B.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 13, yMm: 10 },
            { xMm: 19.25, yMm: 10 },
          ],
        },
      ],
      vias: [
        { id: "v1", xMm: 13, yMm: 10, diameterMm: 0.6, drillMm: 0.3 },
        { id: "v2", xMm: 19.25, yMm: 10, diameterMm: 0.6, drillMm: 0.3 },
      ],
    });
    const graph = buildCopperGraph(doc);
    const pads = boardPads(doc.footprints);
    const r1p2 = pads.find((p) => p.refDes === "R1" && p.pin === "2")!;
    const r2p1 = pads.find((p) => p.refDes === "R2" && p.pin === "1")!;
    expect(graph.padsConnected(r1p2, r2p1)).toBe(true);
  });

  it("does not bridge layers without the vias", () => {
    const doc = seriesBoard({
      tracks: [
        {
          id: "t1",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 10.75, yMm: 10 },
            { xMm: 13, yMm: 10 },
          ],
        },
        {
          id: "t2",
          layer: "B.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 13, yMm: 10 },
            { xMm: 19.25, yMm: 10 },
          ],
        },
      ],
    });
    const graph = buildCopperGraph(doc);
    const pads = boardPads(doc.footprints);
    const r1p2 = pads.find((p) => p.refDes === "R1" && p.pin === "2")!;
    const r2p1 = pads.find((p) => p.refDes === "R2" && p.pin === "1")!;
    expect(graph.padsConnected(r1p2, r2p1)).toBe(false);
  });

  it("a B.Cu track alone cannot reach a front-side SMD pad", () => {
    const doc = seriesBoard({
      tracks: [{ ...JOINING_TRACK, layer: "B.Cu" }],
    });
    const graph = buildCopperGraph(doc);
    const pads = boardPads(doc.footprints);
    const r1p2 = pads.find((p) => p.refDes === "R1" && p.pin === "2")!;
    expect(graph.set.connected("t:t1", `p:${r1p2.footprintId}:${r1p2.pin}`)).toBe(false);
  });

  it("chains connectivity through touching tracks", () => {
    const doc = seriesBoard({
      tracks: [
        {
          id: "t1",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 10.75, yMm: 10 },
            { xMm: 15, yMm: 10 },
          ],
        },
        {
          id: "t2",
          layer: "F.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 15, yMm: 10 },
            { xMm: 19.25, yMm: 10 },
          ],
        },
      ],
    });
    const graph = buildCopperGraph(doc);
    const pads = boardPads(doc.footprints);
    const r1p2 = pads.find((p) => p.refDes === "R1" && p.pin === "2")!;
    const r2p1 = pads.find((p) => p.refDes === "R2" && p.pin === "1")!;
    expect(graph.padsConnected(r1p2, r2p1)).toBe(true);
  });

  it("connects a through-hole pad from the back layer", () => {
    // Header pads are plated, so back-side copper reaches them even though the
    // footprint sits on the front. At 2.54 mm pitch centred on x=10, pin 3 is
    // at x=11.27 — under a track running from x=10 to x=20.
    const doc = normalizePcbDoc({
      board: { widthMm: 80, heightMm: 50 },
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
      tracks: [
        {
          id: "t1",
          layer: "B.Cu",
          widthMm: 0.25,
          points: [
            { xMm: 10, yMm: 10 },
            { xMm: 20, yMm: 10 },
          ],
        },
      ],
    });
    const graph = buildCopperGraph(doc);
    const pad3 = graph.pads.find((p) => p.refDes === "J1" && p.pin === "3")!;
    expect(pad3.xMm).toBeCloseTo(11.27, 6);
    expect(graph.set.connected("t:t1", `p:j1:3`)).toBe(true);
    // Pin 1 sits at x=6.19, off the western end of the track.
    expect(graph.set.connected("t:t1", `p:j1:1`)).toBe(false);
  });
});

describe("ratsnest with copper", () => {
  it("drops the airwire once a track joins the net", () => {
    const before = buildRatsnest(seriesCircuit(), seriesBoard());
    expect(before.airwires).toHaveLength(1);
    expect(before.routedCount).toBe(0);
    expect(before.totalConnections).toBe(1);

    const after = buildRatsnest(seriesCircuit(), seriesBoard({ tracks: [JOINING_TRACK] }));
    expect(after.airwires).toHaveLength(0);
    expect(after.routedCount).toBe(1);
    expect(after.totalConnections).toBe(1);
  });

  it("keeps the airwire when the track misses the pad", () => {
    const doc = seriesBoard({
      tracks: [
        {
          ...JOINING_TRACK,
          // Runs alongside the pads instead of onto them.
          points: [
            { xMm: 10.75, yMm: 14 },
            { xMm: 19.25, yMm: 14 },
          ],
        },
      ],
    });
    const after = buildRatsnest(seriesCircuit(), doc);
    expect(after.airwires).toHaveLength(1);
    expect(after.routedCount).toBe(0);
  });

  it("spans the closest pads between two partially routed groups", () => {
    // Three pads on one net; route two together and the remaining airwire must
    // link the routed group to the third, not re-link the routed pair.
    const c = circuit({
      parts: [
        { id: "r1", type: "wokwi-resistor", label: "R1", x: 0, y: 0 },
        { id: "r2", type: "wokwi-resistor", label: "R2", x: 100, y: 0 },
        { id: "r3", type: "wokwi-resistor", label: "R3", x: 200, y: 0 },
      ],
      wires: [
        { id: "w1", from: { part: "r1", pin: "2" }, to: { part: "r2", pin: "1" } },
        { id: "w2", from: { part: "r2", pin: "1" }, to: { part: "r3", pin: "1" } },
      ],
    });
    const doc = normalizePcbDoc({
      board: { widthMm: 80, heightMm: 50 },
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
        {
          id: "f3",
          libraryId: "R_0603",
          refDes: "R3",
          xMm: 40,
          yMm: 10,
          rotationDeg: 0,
          side: "front",
          partId: "r3",
        },
      ],
      tracks: [JOINING_TRACK],
    });
    const rats = buildRatsnest(c, doc);
    expect(rats.airwires).toHaveLength(1);
    expect(rats.routedCount).toBe(1);
    expect(rats.totalConnections).toBe(2);
    // The remaining airwire must touch R3.
    const refs = [rats.airwires[0]!.from.refDes, rats.airwires[0]!.to.refDes];
    expect(refs).toContain("R3");
  });
});

describe("hit testing", () => {
  it("finds a pad under the cursor on the right layer", () => {
    const doc = seriesBoard();
    const pads = boardPads(doc.footprints);
    expect(padAt(pads, 10.75, 10, "F.Cu", 0.2)?.refDes).toBe("R1");
    // Front-side SMD pads are not reachable from the back.
    expect(padAt(pads, 10.75, 10, "B.Cu", 0.2)).toBeNull();
  });

  it("finds a track and a via under the cursor", () => {
    const doc = seriesBoard({
      tracks: [JOINING_TRACK],
      vias: [{ id: "v1", xMm: 30, yMm: 30, diameterMm: 0.6, drillMm: 0.3 }],
    });
    expect(trackAt(doc.tracks, 15, 10, "F.Cu", 0.2)?.id).toBe("t1");
    expect(trackAt(doc.tracks, 15, 10, "B.Cu", 0.2)).toBeNull();
    expect(viaAt(doc.vias, 30, 30, 0.2)?.id).toBe("v1");
    expect(viaAt(doc.vias, 35, 35, 0.2)).toBeNull();
  });

  it("prefers the last-painted item when copper overlaps exactly", () => {
    const doc = seriesBoard();
    const bottomPad = boardPads(doc.footprints).find(
      (pad) => pad.refDes === "R1" && pad.pin === "2",
    )!;
    const topPad = { ...bottomPad, footprintId: "f-top", refDes: "R9" };
    const tracks: PcbDoc["tracks"] = [
      { ...JOINING_TRACK, id: "track-bottom", layer: "F.Cu" },
      { ...JOINING_TRACK, id: "track-top", layer: "F.Cu" },
    ];
    const vias: PcbDoc["vias"] = [
      { id: "via-bottom", xMm: 30, yMm: 30, diameterMm: 0.6, drillMm: 0.3 },
      { id: "via-top", xMm: 30, yMm: 30, diameterMm: 0.6, drillMm: 0.3 },
    ];
    const zones: PcbDoc["zones"] = [
      {
        id: "zone-bottom",
        layer: "F.Cu",
        points: [
          { xMm: 0, yMm: 0 },
          { xMm: 10, yMm: 0 },
          { xMm: 10, yMm: 10 },
          { xMm: 0, yMm: 10 },
        ],
      },
      {
        id: "zone-top",
        layer: "F.Cu",
        points: [
          { xMm: 2, yMm: 2 },
          { xMm: 8, yMm: 2 },
          { xMm: 8, yMm: 8 },
          { xMm: 2, yMm: 8 },
        ],
      },
    ];

    expect(padAt([bottomPad, topPad], bottomPad.xMm, bottomPad.yMm, "F.Cu", 0)?.refDes).toBe("R9");
    expect(trackAt(tracks, 15, 10, "F.Cu", 0)?.id).toBe("track-top");
    expect(viaAt(vias, 30, 30, 0)?.id).toBe("via-top");
    expect(zoneAt(zones, 5, 5, "F.Cu")?.id).toBe("zone-top");
  });
});

describe("geometry", () => {
  it("reports zero distance for crossing segments", () => {
    expect(segmentSegmentDistance(0, 0, 10, 0, 5, -5, 5, 5)).toBe(0);
  });

  it("measures the gap between parallel segments", () => {
    expect(segmentSegmentDistance(0, 0, 10, 0, 0, 2, 10, 2)).toBeCloseTo(2, 6);
  });

  it("treats a point inside a pad as zero distance", () => {
    const pads = boardPads(seriesBoard().footprints);
    const pad = pads.find((p) => p.refDes === "R1" && p.pin === "1")!;
    expect(pointPadDistance(pad, pad.xMm, pad.yMm)).toBe(0);
  });

  it("accounts for footprint rotation when locating pads", () => {
    const doc = normalizePcbDoc({
      board: { widthMm: 80, heightMm: 50 },
      footprints: [
        {
          id: "f1",
          libraryId: "R_0603",
          refDes: "R1",
          xMm: 10,
          yMm: 10,
          rotationDeg: 90,
          side: "front",
        },
      ],
    });
    const pads = boardPads(doc.footprints);
    // Rotated 90 degrees, the ±0.75 mm pad offset moves from x to y.
    expect(pads.some((p) => Math.abs(p.yMm - 10.75) < 1e-6 && Math.abs(p.xMm - 10) < 1e-6)).toBe(
      true,
    );
  });
});
