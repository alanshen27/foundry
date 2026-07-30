/**
 * Copper connectivity: which pads are actually joined by routed tracks and vias.
 *
 * This is what separates "the schematic says these should connect" (the netlist)
 * from "these are connected on the board" (this file). The ratsnest subtracts
 * one from the other, so an airwire disappears exactly when copper replaces it,
 * and DRC uses the same graph to notice copper bridging two different nets.
 *
 * Connection is decided geometrically rather than by stored ids: a track knows
 * the net it was drawn on, but moving a footprint afterwards can pull a pad out
 * from under a track — and if the answer came from the stored id, the board
 * would keep claiming a connection that the copper no longer makes.
 */

import type { PcbDoc, PcbTrack, PcbVia, PcbZone } from "@/lib/pcb/doc";
import {
  boardPads,
  pointInPolygon,
  pointPadDistance,
  pointSegmentDistance,
  polygonDepth,
  polylineSegments,
  segmentPadDistance,
  segmentSegmentDistance,
  type PadInstance,
} from "@/lib/pcb/geometry";

/** Total centerline length of a routed polyline, in millimetres. */
export function trackLength(points: { xMm: number; yMm: number }[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!;
    const to = points[index]!;
    length += Math.hypot(to.xMm - from.xMm, to.yMm - from.yMm);
  }
  return length;
}

/**
 * Produce the shortest one-corner horizontal/vertical + 45° candidate between
 * two pads. This is a guided route, not an obstacle-avoiding autorouter: DRC
 * remains authoritative and undo removes the candidate as one operation.
 */
export function route45Points(
  from: { xMm: number; yMm: number },
  to: { xMm: number; yMm: number },
): { xMm: number; yMm: number }[] {
  const dx = to.xMm - from.xMm;
  const dy = to.yMm - from.yMm;
  if (dx === 0 || dy === 0 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-9) {
    return [{ ...from }, { ...to }];
  }

  const corner =
    Math.abs(dx) > Math.abs(dy)
      ? {
          xMm: from.xMm + Math.sign(dx) * (Math.abs(dx) - Math.abs(dy)),
          yMm: from.yMm,
        }
      : {
          xMm: from.xMm,
          yMm: from.yMm + Math.sign(dy) * (Math.abs(dy) - Math.abs(dx)),
        };
  return [{ ...from }, corner, { ...to }];
}

/** Copper within this distance is touching. Guards float error, not a real gap. */
const TOUCH_EPS = 1e-6;

export class DisjointSet {
  private parent = new Map<string, string>();

  find(key: string): string {
    let root = this.parent.get(key) ?? key;
    while (root !== (this.parent.get(root) ?? root)) root = this.parent.get(root) ?? root;
    let cursor = key;
    while (cursor !== root) {
      const next = this.parent.get(cursor) ?? cursor;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }
}

export const padKey = (footprintId: string, pin: string) => `p:${footprintId}:${pin}`;
const trackKey = (id: string) => `t:${id}`;
const viaKey = (id: string) => `v:${id}`;
const zoneKey = (id: string) => `z:${id}`;

/** Distance from a via's copper annulus to a track's copper. */
function viaTrackDistance(via: PcbVia, track: PcbTrack): number {
  let best = Infinity;
  for (const [ax, ay, bx, by] of polylineSegments(track.points)) {
    best = Math.min(best, pointSegmentDistance(via.xMm, via.yMm, ax, ay, bx, by));
    if (best === 0) break;
  }
  return Math.max(0, best - via.diameterMm / 2 - track.widthMm / 2);
}

function trackPadDistance(track: PcbTrack, pad: PadInstance): number {
  let best = Infinity;
  for (const [ax, ay, bx, by] of polylineSegments(track.points)) {
    best = Math.min(best, segmentPadDistance(pad, ax, ay, bx, by));
    if (best === 0) break;
  }
  return Math.max(0, best - track.widthMm / 2);
}

function trackTrackDistance(a: PcbTrack, b: PcbTrack): number {
  let best = Infinity;
  for (const [ax, ay, bx, by] of polylineSegments(a.points)) {
    for (const [cx, cy, dx, dy] of polylineSegments(b.points)) {
      best = Math.min(best, segmentSegmentDistance(ax, ay, bx, by, cx, cy, dx, dy));
      if (best === 0) return 0;
    }
  }
  return Math.max(0, best - a.widthMm / 2 - b.widthMm / 2);
}

export type CopperGraph = {
  set: DisjointSet;
  pads: PadInstance[];
  /** True when copper physically joins these two pads. */
  padsConnected: (a: PadInstance, b: PadInstance) => boolean;
};

/**
 * Does this zone actually surround the feature at (x, y)? Being inside the
 * outline is not enough — a pad sitting in the outline's margin is cleared away
 * rather than poured around, so require it be inside by at least the clearance.
 */
function zoneCovers(zone: PcbZone, x: number, y: number, fallbackClearance: number): boolean {
  const clearance = zone.clearanceMm ?? fallbackClearance;
  return polygonDepth(zone.points, x, y) >= clearance;
}

/**
 * Union-find over every piece of copper on the board. O(n²) in tracks, which is
 * fine for hand-routed boards (hundreds of tracks, not tens of thousands).
 *
 * `padNets` maps pad keys to schematic net names and is only needed for zones:
 * a pour connects the pads on its own net and clears everything else, so
 * without it the zones contribute no connectivity.
 */
export function buildCopperGraph(doc: PcbDoc, padNets?: Map<string, string>): CopperGraph {
  const set = new DisjointSet();
  const pads = boardPads(doc.footprints);

  // Track to pad, where the pad reaches that layer.
  for (const track of doc.tracks) {
    for (const pad of pads) {
      if (!pad.layers.includes(track.layer)) continue;
      if (trackPadDistance(track, pad) <= TOUCH_EPS) {
        set.union(trackKey(track.id), padKey(pad.footprintId, pad.pin));
      }
    }
  }

  // Track to track on the same layer.
  for (let i = 0; i < doc.tracks.length; i++) {
    for (let j = i + 1; j < doc.tracks.length; j++) {
      const a = doc.tracks[i]!;
      const b = doc.tracks[j]!;
      if (a.layer !== b.layer) continue;
      if (trackTrackDistance(a, b) <= TOUCH_EPS) set.union(trackKey(a.id), trackKey(b.id));
    }
  }

  // Vias span both layers, so they join copper regardless of track layer.
  for (const via of doc.vias) {
    for (const track of doc.tracks) {
      if (viaTrackDistance(via, track) <= TOUCH_EPS) {
        set.union(viaKey(via.id), trackKey(track.id));
      }
    }
    for (const pad of pads) {
      if (Math.max(0, pointPadDistance(pad, via.xMm, via.yMm) - via.diameterMm / 2) <= TOUCH_EPS) {
        set.union(viaKey(via.id), padKey(pad.footprintId, pad.pin));
      }
    }
  }

  // Overlapping vias.
  for (let i = 0; i < doc.vias.length; i++) {
    for (let j = i + 1; j < doc.vias.length; j++) {
      const a = doc.vias[i]!;
      const b = doc.vias[j]!;
      const gap = Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm) - a.diameterMm / 2 - b.diameterMm / 2;
      if (gap <= TOUCH_EPS) set.union(viaKey(a.id), viaKey(b.id));
    }
  }

  // Zones pour around their own net and clear every other, so a same-net
  // feature sitting inside the outline is joined and a foreign one is not.
  for (const zone of doc.zones) {
    if (!zone.net) continue;
    for (const pad of pads) {
      if (!pad.layers.includes(zone.layer)) continue;
      const key = padKey(pad.footprintId, pad.pin);
      if (padNets?.get(key) !== zone.net) continue;
      if (zoneCovers(zone, pad.xMm, pad.yMm, doc.rules.clearanceMm)) {
        set.union(zoneKey(zone.id), key);
      }
    }
    // Stitching vias tie the pour together across layers.
    for (const via of doc.vias) {
      if (via.net !== zone.net) continue;
      if (zoneCovers(zone, via.xMm, via.yMm, doc.rules.clearanceMm)) {
        set.union(zoneKey(zone.id), viaKey(via.id));
      }
    }
  }

  return {
    set,
    pads,
    padsConnected: (a, b) =>
      set.connected(padKey(a.footprintId, a.pin), padKey(b.footprintId, b.pin)),
  };
}

/** The zone whose outline contains (x, y) on `layer`, for select/delete. */
export function zoneAt(zones: PcbZone[], x: number, y: number, layer: string): PcbZone | null {
  // SVG paints later zones on top, so hit-test in reverse paint order.
  for (let index = zones.length - 1; index >= 0; index--) {
    const zone = zones[index]!;
    if (zone.layer !== layer) continue;
    if (pointInPolygon(zone.points, x, y)) return zone;
  }
  return null;
}

/**
 * The pad nearest `(x, y)` on `layer`, within `toleranceMm` of its copper —
 * what the routing tool snaps a click to.
 */
export function padAt(
  pads: PadInstance[],
  x: number,
  y: number,
  layer: string,
  toleranceMm = 0,
): PadInstance | null {
  let best: PadInstance | null = null;
  let bestDist = Infinity;
  for (const pad of pads) {
    if (!pad.layers.includes(layer as PadInstance["layers"][number])) continue;
    const d = pointPadDistance(pad, x, y);
    if (d <= toleranceMm && d <= bestDist) {
      bestDist = d;
      best = pad;
    }
  }
  return best;
}

/** The via nearest `(x, y)`, within `toleranceMm` of its annulus. */
export function viaAt(vias: PcbVia[], x: number, y: number, toleranceMm = 0): PcbVia | null {
  let best: PcbVia | null = null;
  let bestDist = Infinity;
  for (const via of vias) {
    const d = Math.max(0, Math.hypot(via.xMm - x, via.yMm - y) - via.diameterMm / 2);
    if (d <= toleranceMm && d <= bestDist) {
      bestDist = d;
      best = via;
    }
  }
  return best;
}

/** The track whose copper is nearest `(x, y)` on `layer`, for select/delete. */
export function trackAt(
  tracks: PcbTrack[],
  x: number,
  y: number,
  layer: string,
  toleranceMm = 0,
): PcbTrack | null {
  let best: PcbTrack | null = null;
  let bestDist = Infinity;
  for (const track of tracks) {
    if (track.layer !== layer) continue;
    for (const [ax, ay, bx, by] of polylineSegments(track.points)) {
      const d = Math.max(0, pointSegmentDistance(x, y, ax, ay, bx, by) - track.widthMm / 2);
      if (d <= toleranceMm && d <= bestDist) {
        bestDist = d;
        best = track;
      }
    }
  }
  return best;
}
