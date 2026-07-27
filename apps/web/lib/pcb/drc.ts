/**
 * Design rule checking — the board's own account of why it is not yet
 * manufacturable.
 *
 * Two families of problem live here and they are genuinely different. Geometric
 * rules (clearance, edge, annular ring) ask whether the fab can make the board.
 * Connectivity rules (shorts, unrouted, dangling) ask whether the board matches
 * the schematic. Both are reported together because a user fixing a layout does
 * not care which category a mistake fell into.
 *
 * Shorts are derived from the copper graph rather than from the `net` field
 * stored on a track: that field records what the user *meant*, and a short is
 * precisely the case where the copper disagrees with the intent.
 */

import { footprintDef, type PcbDoc, type PcbFootprint } from "@/lib/pcb/doc";
import {
  pointSegmentDistance,
  polylineSegments,
  segmentPadDistance,
  segmentSegmentDistance,
  type PadInstance,
} from "@/lib/pcb/geometry";
import { buildCopperGraph, padKey, type CopperGraph } from "@/lib/pcb/routing";
import { netsByPad, type Ratsnest } from "@/lib/pcb/netlist";

export type DrcSeverity = "error" | "warning";

export type DrcViolation = {
  /** Stable per-rule id, so the UI can group and the tests can assert on it. */
  rule:
    | "clearance"
    | "short"
    | "unrouted"
    | "edge-clearance"
    | "off-board"
    | "track-width"
    | "annular-ring"
    | "dangling-track"
    | "courtyard-overlap";
  severity: DrcSeverity;
  message: string;
  /** Where to point the camera, in board millimetres. */
  atMm?: { xMm: number; yMm: number };
};

export type DrcResult = {
  violations: DrcViolation[];
  errorCount: number;
  warningCount: number;
};

const midpoint = (ax: number, ay: number, bx: number, by: number) => ({
  xMm: (ax + bx) / 2,
  yMm: (ay + by) / 2,
});

/**
 * Copper that bridges two different nets. Walks each connected component of the
 * copper graph and reports any that contains pads from more than one net.
 */
function checkShorts(graph: CopperGraph, padNets: Map<string, string>): DrcViolation[] {
  const netsPerComponent = new Map<string, Map<string, PadInstance>>();

  for (const pad of graph.pads) {
    const key = padKey(pad.footprintId, pad.pin);
    const net = padNets.get(key);
    if (!net) continue;
    const root = graph.set.find(key);
    let seen = netsPerComponent.get(root);
    if (!seen) {
      seen = new Map();
      netsPerComponent.set(root, seen);
    }
    if (!seen.has(net)) seen.set(net, pad);
  }

  const out: DrcViolation[] = [];
  for (const seen of netsPerComponent.values()) {
    if (seen.size < 2) continue;
    const entries = [...seen.entries()];
    const names = entries.map(([net]) => net).sort();
    const pad = entries[0]![1];
    out.push({
      rule: "short",
      severity: "error",
      message: `Copper shorts ${names.join(" to ")} (at ${pad.refDes}.${pad.pin}).`,
      atMm: { xMm: pad.xMm, yMm: pad.yMm },
    });
  }
  return out;
}

/**
 * Copper-to-copper gaps below the clearance rule, between pieces that are not
 * already the same electrical node. Same-node copper is *meant* to touch, so
 * comparing it would report every correctly routed track as a violation.
 */
function checkClearance(doc: PcbDoc, graph: CopperGraph): DrcViolation[] {
  const out: DrcViolation[] = [];
  const min = doc.rules.clearanceMm;
  const trackNode = (id: string) => `t:${id}`;
  const viaNode = (id: string) => `v:${id}`;

  const report = (
    gap: number,
    what: string,
    at: { xMm: number; yMm: number },
  ) => {
    out.push({
      rule: "clearance",
      severity: "error",
      message: `${what} gap ${gap.toFixed(3)} mm is below the ${min} mm clearance rule.`,
      atMm: at,
    });
  };

  // Track to track, same layer.
  for (let i = 0; i < doc.tracks.length; i++) {
    for (let j = i + 1; j < doc.tracks.length; j++) {
      const a = doc.tracks[i]!;
      const b = doc.tracks[j]!;
      if (a.layer !== b.layer) continue;
      if (graph.set.connected(trackNode(a.id), trackNode(b.id))) continue;
      let best = Infinity;
      let at = { xMm: a.points[0]!.xMm, yMm: a.points[0]!.yMm };
      for (const [ax, ay, bx, by] of polylineSegments(a.points)) {
        for (const [cx, cy, dx, dy] of polylineSegments(b.points)) {
          const d = segmentSegmentDistance(ax, ay, bx, by, cx, cy, dx, dy) - a.widthMm / 2 - b.widthMm / 2;
          if (d < best) {
            best = d;
            at = midpoint(ax, ay, cx, cy);
          }
        }
      }
      if (best < min) report(Math.max(0, best), `Tracks on ${a.layer}`, at);
    }
  }

  // Track to pad, where the pad reaches that layer.
  for (const track of doc.tracks) {
    for (const pad of graph.pads) {
      if (!pad.layers.includes(track.layer)) continue;
      if (graph.set.connected(trackNode(track.id), padKey(pad.footprintId, pad.pin))) continue;
      let best = Infinity;
      for (const [ax, ay, bx, by] of polylineSegments(track.points)) {
        best = Math.min(best, segmentPadDistance(pad, ax, ay, bx, by) - track.widthMm / 2);
      }
      if (best < min) {
        report(Math.max(0, best), `Track to pad ${pad.refDes}.${pad.pin}`, {
          xMm: pad.xMm,
          yMm: pad.yMm,
        });
      }
    }
  }

  // Via to track and via to pad.
  for (const via of doc.vias) {
    for (const track of doc.tracks) {
      if (graph.set.connected(viaNode(via.id), trackNode(track.id))) continue;
      let best = Infinity;
      for (const [ax, ay, bx, by] of polylineSegments(track.points)) {
        best = Math.min(
          best,
          pointSegmentDistance(via.xMm, via.yMm, ax, ay, bx, by) - via.diameterMm / 2 - track.widthMm / 2,
        );
      }
      if (best < min) {
        report(Math.max(0, best), `Via to track on ${track.layer}`, { xMm: via.xMm, yMm: via.yMm });
      }
    }
    for (const pad of graph.pads) {
      if (graph.set.connected(viaNode(via.id), padKey(pad.footprintId, pad.pin))) continue;
      const d = segmentPadDistance(pad, via.xMm, via.yMm, via.xMm, via.yMm) - via.diameterMm / 2;
      if (d < min) {
        report(Math.max(0, d), `Via to pad ${pad.refDes}.${pad.pin}`, { xMm: via.xMm, yMm: via.yMm });
      }
    }
  }

  // Pad to pad, for footprints placed on top of each other.
  for (let i = 0; i < graph.pads.length; i++) {
    for (let j = i + 1; j < graph.pads.length; j++) {
      const a = graph.pads[i]!;
      const b = graph.pads[j]!;
      if (a.footprintId === b.footprintId) continue;
      if (!a.layers.some((l) => b.layers.includes(l))) continue;
      if (graph.set.connected(padKey(a.footprintId, a.pin), padKey(b.footprintId, b.pin))) continue;
      const d = segmentPadDistance(a, b.xMm, b.yMm, b.xMm, b.yMm) - Math.min(b.wMm, b.hMm) / 2;
      if (d < min) {
        report(Math.max(0, d), `Pads ${a.refDes}.${a.pin} and ${b.refDes}.${b.pin}`, {
          xMm: (a.xMm + b.xMm) / 2,
          yMm: (a.yMm + b.yMm) / 2,
        });
      }
    }
  }

  return out;
}

/** Copper outside the outline, or nearer the edge than the rule allows. */
function checkEdges(doc: PcbDoc, graph: CopperGraph): DrcViolation[] {
  const out: DrcViolation[] = [];
  const { widthMm, heightMm } = doc.board;
  const edge = doc.rules.edgeClearanceMm;

  /** Signed inset: negative means outside the board. */
  const inset = (x: number, y: number) => Math.min(x, y, widthMm - x, heightMm - y);

  for (const track of doc.tracks) {
    for (const p of track.points) {
      const margin = inset(p.xMm, p.yMm) - track.widthMm / 2;
      if (margin < 0) {
        out.push({
          rule: "off-board",
          severity: "error",
          message: `Track on ${track.layer} runs outside the board outline.`,
          atMm: { xMm: p.xMm, yMm: p.yMm },
        });
        break;
      }
      if (margin < edge) {
        out.push({
          rule: "edge-clearance",
          severity: "warning",
          message: `Track on ${track.layer} is ${margin.toFixed(3)} mm from the edge (rule ${edge} mm).`,
          atMm: { xMm: p.xMm, yMm: p.yMm },
        });
        break;
      }
    }
  }

  for (const pad of graph.pads) {
    const margin = inset(pad.xMm, pad.yMm) - Math.max(pad.wMm, pad.hMm) / 2;
    if (margin < 0) {
      out.push({
        rule: "off-board",
        severity: "error",
        message: `Pad ${pad.refDes}.${pad.pin} is outside the board outline.`,
        atMm: { xMm: pad.xMm, yMm: pad.yMm },
      });
    }
  }

  for (const via of doc.vias) {
    const margin = inset(via.xMm, via.yMm) - via.diameterMm / 2;
    if (margin < 0) {
      out.push({
        rule: "off-board",
        severity: "error",
        message: "Via is outside the board outline.",
        atMm: { xMm: via.xMm, yMm: via.yMm },
      });
    } else if (margin < edge) {
      out.push({
        rule: "edge-clearance",
        severity: "warning",
        message: `Via is ${margin.toFixed(3)} mm from the edge (rule ${edge} mm).`,
        atMm: { xMm: via.xMm, yMm: via.yMm },
      });
    }
  }

  return out;
}

/** Fab limits on the copper features themselves. */
function checkFeatureSizes(doc: PcbDoc): DrcViolation[] {
  const out: DrcViolation[] = [];

  for (const track of doc.tracks) {
    if (track.widthMm < doc.rules.trackWidthMm) {
      out.push({
        rule: "track-width",
        severity: "warning",
        message: `Track is ${track.widthMm} mm, under the ${doc.rules.trackWidthMm} mm minimum.`,
        atMm: { xMm: track.points[0]!.xMm, yMm: track.points[0]!.yMm },
      });
    }
  }

  for (const via of doc.vias) {
    // Annular ring is the copper left around the drill on each side.
    const ring = (via.diameterMm - via.drillMm) / 2;
    if (ring < 0.05) {
      out.push({
        rule: "annular-ring",
        severity: "error",
        message: `Via annular ring is ${ring.toFixed(3)} mm; most fabs need 0.05 mm or more.`,
        atMm: { xMm: via.xMm, yMm: via.yMm },
      });
    }
  }

  return out;
}

/**
 * Track ends that touch nothing. Usually an abandoned route, and always copper
 * the board does not need — worth a warning rather than an error because a
 * deliberate test point looks the same.
 */
function checkDangling(doc: PcbDoc, graph: CopperGraph): DrcViolation[] {
  const out: DrcViolation[] = [];

  for (const track of doc.tracks) {
    const ends = [track.points[0]!, track.points[track.points.length - 1]!];
    for (const end of ends) {
      const touchesPad = graph.pads.some(
        (pad) =>
          pad.layers.includes(track.layer) &&
          segmentPadDistance(pad, end.xMm, end.yMm, end.xMm, end.yMm) <= track.widthMm / 2 + 1e-6,
      );
      if (touchesPad) continue;

      const touchesVia = doc.vias.some(
        (via) => Math.hypot(via.xMm - end.xMm, via.yMm - end.yMm) <= via.diameterMm / 2 + track.widthMm / 2 + 1e-6,
      );
      if (touchesVia) continue;

      const touchesTrack = doc.tracks.some((other) => {
        if (other.id === track.id || other.layer !== track.layer) return false;
        return polylineSegments(other.points).some(
          ([ax, ay, bx, by]) =>
            pointSegmentDistance(end.xMm, end.yMm, ax, ay, bx, by) <=
            track.widthMm / 2 + other.widthMm / 2 + 1e-6,
        );
      });
      if (touchesTrack) continue;

      out.push({
        rule: "dangling-track",
        severity: "warning",
        message: `Track end on ${track.layer} connects to nothing.`,
        atMm: { xMm: end.xMm, yMm: end.yMm },
      });
    }
  }

  return out;
}

/** Footprint bodies overlapping — a placement error, not a copper one. */
function checkCourtyards(doc: PcbDoc): DrcViolation[] {
  const out: DrcViolation[] = [];

  for (let i = 0; i < doc.footprints.length; i++) {
    for (let j = i + 1; j < doc.footprints.length; j++) {
      const a = doc.footprints[i]!;
      const b = doc.footprints[j]!;
      if (a.side !== b.side) continue;
      const defA = footprintBody(a);
      const defB = footprintBody(b);
      if (!defA || !defB) continue;
      const overlapX = Math.abs(a.xMm - b.xMm) < (defA.w + defB.w) / 2;
      const overlapY = Math.abs(a.yMm - b.yMm) < (defA.h + defB.h) / 2;
      if (overlapX && overlapY) {
        out.push({
          rule: "courtyard-overlap",
          severity: "warning",
          message: `${a.refDes} and ${b.refDes} overlap.`,
          atMm: { xMm: (a.xMm + b.xMm) / 2, yMm: (a.yMm + b.yMm) / 2 },
        });
      }
    }
  }
  return out;
}

/** Body extents with rotation applied, as an axis-aligned approximation. */
function footprintBody(fp: PcbFootprint): { w: number; h: number } | null {
  const def = footprintDef(fp.libraryId);
  if (!def) return null;
  const rot = ((fp.rotationDeg % 180) + 180) % 180;
  // A quarter turn swaps the body's width and height.
  const swap = rot > 45 && rot < 135;
  return swap ? { w: def.bodyHMm, h: def.bodyWMm } : { w: def.bodyWMm, h: def.bodyHMm };
}

/**
 * Every rule, against one board. `ratsnest` supplies the schematic's intent —
 * pass the same one the canvas renders so the counts agree.
 */
export function runDrc(doc: PcbDoc, ratsnest: Ratsnest, copper?: CopperGraph): DrcResult {
  const graph = copper ?? buildCopperGraph(doc);

  // Re-key the schematic's pad->net map onto the copper graph's pad keys.
  const byPadId = netsByPad(ratsnest.nets, doc);
  const padNets = new Map<string, string>();
  for (const pad of graph.pads) {
    const net = byPadId.get(`${pad.footprintId}:${pad.pin}`);
    if (net) padNets.set(padKey(pad.footprintId, pad.pin), net);
  }

  const violations: DrcViolation[] = [
    ...checkShorts(graph, padNets),
    ...checkClearance(doc, graph),
    ...checkEdges(doc, graph),
    ...checkFeatureSizes(doc),
    ...checkDangling(doc, graph),
    ...checkCourtyards(doc),
  ];

  if (ratsnest.airwires.length > 0) {
    violations.push({
      rule: "unrouted",
      severity: "error",
      message: `${ratsnest.airwires.length} connection${ratsnest.airwires.length === 1 ? "" : "s"} still unrouted.`,
      atMm: {
        xMm: ratsnest.airwires[0]!.from.xMm,
        yMm: ratsnest.airwires[0]!.from.yMm,
      },
    });
  }

  return {
    violations,
    errorCount: violations.filter((v) => v.severity === "error").length,
    warningCount: violations.filter((v) => v.severity === "warning").length,
  };
}
