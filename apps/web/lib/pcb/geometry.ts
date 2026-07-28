/**
 * Shared 2D geometry for the board: segment distances and pad hit-testing.
 *
 * Connectivity and DRC ask the same question at different thresholds — "how far
 * apart are these two pieces of copper?" — so the primitives live here rather
 * than being duplicated with slightly different epsilons in each.
 *
 * Everything is in board millimetres. Pads are rotated rectangles (the
 * footprint's rotation), so the pad routines work by transforming the query
 * into the pad's local frame where the rectangle is axis-aligned.
 */

import { footprintDef, type PcbFootprint, type PcbLayer, type PcbPadDef, type PcbPoint } from "@/lib/pcb/doc";

/**
 * Footprint-local pad centre -> board millimetres, mirroring the transform the
 * canvas applies (`translate(x y) rotate(deg)`: SVG rotates clockwise with +Y
 * pointing down). Back-side footprints are not mirrored, matching what the 2D
 * canvas draws today.
 *
 * Lives here rather than in netlist.ts so the geometry layer has no upward
 * dependencies — netlist and routing both sit on top of it.
 */
export function padWorldPosition(
  fp: Pick<PcbFootprint, "xMm" | "yMm" | "rotationDeg">,
  pad: { xMm: number; yMm: number },
): { xMm: number; yMm: number } {
  const theta = (fp.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    xMm: fp.xMm + pad.xMm * cos - pad.yMm * sin,
    yMm: fp.yMm + pad.xMm * sin + pad.yMm * cos,
  };
}

/** Squared length, to avoid a sqrt in the inner loops. */
function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Shortest distance from a point to segment ab. */
export function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const len2 = dist2(ax, ay, bx, by);
  if (len2 === 0) return Math.sqrt(dist2(px, py, ax, ay));
  // Projection of ap onto ab, clamped to the segment.
  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt(dist2(px, py, ax + t * (bx - ax), ay + t * (by - ay)));
}

function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

/** True when segments ab and cd properly intersect or touch. */
export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = orientation(cx, cy, dx, dy, ax, ay);
  const d2 = orientation(cx, cy, dx, dy, bx, by);
  const d3 = orientation(ax, ay, bx, by, cx, cy);
  const d4 = orientation(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  // Collinear touching cases fall out of the distance test below.
  return false;
}

/**
 * Shortest distance between segments ab and cd. Zero when they cross, so
 * callers can treat "touching" and "overlapping" identically.
 */
export function segmentSegmentDistance(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    pointSegmentDistance(ax, ay, cx, cy, dx, dy),
    pointSegmentDistance(bx, by, cx, cy, dx, dy),
    pointSegmentDistance(cx, cy, ax, ay, bx, by),
    pointSegmentDistance(dx, dy, ax, ay, bx, by),
  );
}

/** The copper layers a pad occupies: through-hole spans both, SMD one side. */
export function padLayers(fp: PcbFootprint, pad: PcbPadDef): PcbLayer[] {
  if (pad.plated) return ["F.Cu", "B.Cu"];
  return [fp.side === "front" ? "F.Cu" : "B.Cu"];
}

export type PadInstance = {
  footprintId: string;
  refDes: string;
  pin: string;
  /** Pad centre in board millimetres. */
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  shape: "rect" | "oval";
  /** Footprint rotation, so the rectangle can be un-rotated for hit tests. */
  rotationDeg: number;
  layers: PcbLayer[];
};

/** Every pad on the board, already transformed to board coordinates. */
export function boardPads(footprints: PcbFootprint[]): PadInstance[] {
  const out: PadInstance[] = [];
  for (const fp of footprints) {
    const def = footprintDef(fp.libraryId);
    if (!def) continue;
    for (const pad of def.pads) {
      const at = padWorldPosition(fp, pad);
      out.push({
        footprintId: fp.id,
        refDes: fp.refDes,
        pin: pad.pin,
        xMm: at.xMm,
        yMm: at.yMm,
        wMm: pad.wMm,
        hMm: pad.hMm,
        shape: pad.shape,
        rotationDeg: fp.rotationDeg,
        layers: padLayers(fp, pad),
      });
    }
  }
  return out;
}

/** Transform a board point into the pad's local (un-rotated, centred) frame. */
function toPadLocal(pad: PadInstance, x: number, y: number): [number, number] {
  const theta = (-pad.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const dx = x - pad.xMm;
  const dy = y - pad.yMm;
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

/**
 * Distance from a board point to the pad's copper, 0 when inside. Ovals are
 * treated as a stadium (rectangle with semicircular caps), which is what an
 * oval pad actually is.
 */
export function pointPadDistance(pad: PadInstance, x: number, y: number): number {
  const [lx, ly] = toPadLocal(pad, x, y);
  if (pad.shape === "oval") {
    const r = Math.min(pad.wMm, pad.hMm) / 2;
    // Collapse the stadium to its spine, then subtract the cap radius.
    const spine = Math.max(0, (Math.max(pad.wMm, pad.hMm) - Math.min(pad.wMm, pad.hMm)) / 2);
    const [sx, sy] = pad.wMm >= pad.hMm ? [spine, 0] : [0, spine];
    return Math.max(0, pointSegmentDistance(lx, ly, -sx, -sy, sx, sy) - r);
  }
  const ox = Math.max(Math.abs(lx) - pad.wMm / 2, 0);
  const oy = Math.max(Math.abs(ly) - pad.hMm / 2, 0);
  return Math.hypot(ox, oy);
}

export function pointInPad(pad: PadInstance, x: number, y: number, toleranceMm = 0): boolean {
  return pointPadDistance(pad, x, y) <= toleranceMm;
}

/** Shortest distance from segment ab to the pad's copper. */
export function segmentPadDistance(
  pad: PadInstance,
  ax: number, ay: number, bx: number, by: number,
): number {
  const [lax, lay] = toPadLocal(pad, ax, ay);
  const [lbx, lby] = toPadLocal(pad, bx, by);

  if (pad.shape === "oval") {
    const r = Math.min(pad.wMm, pad.hMm) / 2;
    const spine = Math.max(0, (Math.max(pad.wMm, pad.hMm) - Math.min(pad.wMm, pad.hMm)) / 2);
    const [sx, sy] = pad.wMm >= pad.hMm ? [spine, 0] : [0, spine];
    return Math.max(0, segmentSegmentDistance(lax, lay, lbx, lby, -sx, -sy, sx, sy) - r);
  }

  const hw = pad.wMm / 2;
  const hh = pad.hMm / 2;
  // Either endpoint inside the rectangle means distance 0.
  const inside = (x: number, y: number) => Math.abs(x) <= hw && Math.abs(y) <= hh;
  if (inside(lax, lay) || inside(lbx, lby)) return 0;

  // Otherwise the closest approach is to one of the four edges.
  const corners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const [cx, cy] = corners[i]!;
    const [dx, dy] = corners[(i + 1) % 4]!;
    best = Math.min(best, segmentSegmentDistance(lax, lay, lbx, lby, cx, cy, dx, dy));
    if (best === 0) return 0;
  }
  return best;
}

/**
 * Ray-casting point-in-polygon. Counts crossings of a ray heading +X; an odd
 * count means inside. Points exactly on an edge are not guaranteed either way,
 * which is fine — callers pair this with a clearance margin.
 */
export function pointInPolygon(polygon: PcbPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const straddles = a.yMm > y !== b.yMm > y;
    if (!straddles) continue;
    // X of the edge where it crosses this row.
    const crossX = ((b.xMm - a.xMm) * (y - a.yMm)) / (b.yMm - a.yMm) + a.xMm;
    if (x < crossX) inside = !inside;
  }
  return inside;
}

/** Shortest distance from a point to a closed polygon's boundary. */
export function pointPolygonEdgeDistance(polygon: PcbPoint[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    best = Math.min(best, pointSegmentDistance(x, y, a.xMm, a.yMm, b.xMm, b.yMm));
  }
  return best;
}

/**
 * Signed distance into a polygon: positive inside (distance to the nearest
 * edge), negative outside. Lets callers require a feature be not merely inside
 * a pour but far enough in to actually be surrounded by copper.
 */
export function polygonDepth(polygon: PcbPoint[], x: number, y: number): number {
  const edge = pointPolygonEdgeDistance(polygon, x, y);
  return pointInPolygon(polygon, x, y) ? edge : -edge;
}

/** Segments of a polyline, as flat [ax, ay, bx, by] tuples. */
export function polylineSegments(points: PcbPoint[]): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    out.push([a.xMm, a.yMm, b.xMm, b.yMm]);
  }
  return out;
}
