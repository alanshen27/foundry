/**
 * Netlist derivation and ratsnest (airwire) computation — the bridge between
 * the schematic (lib/circuit/catalog.ts) and the board (lib/pcb/doc.ts).
 *
 * Nets come purely from the schematic's wires: pin names are only knowable at
 * runtime from each Wokwi element's `pinInfo`, so there is no server-side pin
 * table to consult. Every wire endpoint is `{ part, pin }`, which is all a net
 * needs — two endpoints joined by a wire are the same net, transitively.
 *
 * Getting from a schematic pin to a physical pad is genuinely ambiguous (a
 * Wokwi LED's A/C vs. an LED_0805's 1/2), so the link is explicit rather than
 * guessed: `partId` ties a footprint to a schematic part and `pinMap` handles
 * differing pin names. Anything that can't be resolved is reported in `issues`
 * instead of being silently dropped.
 */

import type { CircuitDoc } from "@/lib/circuit/catalog";
import { padByPin, type PcbDoc, type PcbFootprint } from "@/lib/pcb/doc";
import { padWorldPosition } from "@/lib/pcb/geometry";
import { buildCopperGraph, padKey, type CopperGraph } from "@/lib/pcb/routing";

// Re-exported so callers (and the existing tests) can keep importing the pad
// transform from the netlist module it used to live in.
export { padWorldPosition };

/** A schematic pin: the part it belongs to and the pin name on that part. */
export type NetNode = { partId: string; pin: string };

export type Net = {
  /** "GND", "5V", or a generated "N$1". */
  name: string;
  nodes: NetNode[];
};

/** One straight line between two pads on the same net, in board millimetres. */
export type Airwire = {
  net: string;
  from: { footprintId: string; refDes: string; pin: string; xMm: number; yMm: number };
  to: { footprintId: string; refDes: string; pin: string; xMm: number; yMm: number };
};

export type RatsnestIssues = {
  /** Schematic parts with wires but no footprint claiming them via partId. */
  unlinkedParts: { partId: string; label: string }[];
  /** Wired pins whose footprint has no matching pad. */
  unmappedPins: { refDes: string; partId: string; pin: string }[];
  /** Footprints whose partId names a part that is no longer in the schematic. */
  danglingFootprints: { refDes: string; partId: string }[];
};

export type Ratsnest = {
  nets: Net[];
  /** Only the connections still to be routed; copper removes them from here. */
  airwires: Airwire[];
  issues: RatsnestIssues;
  /** Connections the copper already makes, for a "12 / 20 routed" readout. */
  routedCount: number;
  /** Connections needed in total (routed + remaining airwires). */
  totalConnections: number;
};

const nodeKey = (partId: string, pin: string) => `${partId}\0${pin}`;

/**
 * Power/ground rails get their conventional name so the board is readable;
 * everything else is numbered. Matched against the schematic pin names Wokwi
 * uses (GND.1, GND.2, 5V, 3V3, VIN, VBUS).
 */
function railName(pin: string): string | null {
  if (/^gnd\b/i.test(pin)) return "GND";
  const m = /^(5V|3V3|3\.3V|VCC|VDD|VIN|VBUS)\b/i.exec(pin);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Connected components over the schematic's wires. Each component is one net.
 * Nets are returned in a stable order (first appearance in `wires`) so the
 * generated N$ numbers don't shuffle between renders.
 */
export function buildNets(circuit: CircuitDoc): Net[] {
  const parent = new Map<string, string>();

  const find = (key: string): string => {
    let root = parent.get(key) ?? key;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
    // Path compression, so long daisy chains stay cheap.
    let cursor = key;
    while (cursor !== root) {
      const next = parent.get(cursor) ?? cursor;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };

  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const nodes = new Map<string, NetNode>();
  const order: string[] = [];
  const seen = (partId: string, pin: string) => {
    const key = nodeKey(partId, pin);
    if (!nodes.has(key)) {
      nodes.set(key, { partId, pin });
      parent.set(key, key);
      order.push(key);
    }
    return key;
  };

  for (const wire of circuit.wires) {
    if (!wire.from?.part || !wire.to?.part) continue;
    const a = seen(wire.from.part, wire.from.pin);
    const b = seen(wire.to.part, wire.to.pin);
    union(a, b);
  }

  const groups = new Map<string, NetNode[]>();
  for (const key of order) {
    const root = find(key);
    const group = groups.get(root);
    if (group) group.push(nodes.get(key)!);
    else groups.set(root, [nodes.get(key)!]);
  }

  const labelsByRoot = new Map<string, string>();
  for (const wire of circuit.wires) {
    const label = wire.label?.trim();
    if (!label) continue;
    const key = nodeKey(wire.from.part, wire.from.pin);
    if (!parent.has(key)) continue;
    const root = find(key);
    if (!labelsByRoot.has(root)) labelsByRoot.set(root, label);
  }

  let generated = 0;
  return [...groups.entries()].map(([root, members]) => {
    const rail = members.map((n) => railName(n.pin)).find((name): name is string => Boolean(name));
    return { name: labelsByRoot.get(root) ?? rail ?? `N$${++generated}`, nodes: members };
  });
}

/** The pad a schematic pin lands on: pinMap first, then a direct pad-name match. */
export function resolvePad(fp: PcbFootprint, schematicPin: string) {
  const mapped = fp.pinMap?.[schematicPin];
  if (mapped) return padByPin(fp.libraryId, mapped);
  return padByPin(fp.libraryId, schematicPin);
}

/**
 * Minimum spanning tree over *groups* of pads (Prim's, O(n²) — nets are small).
 *
 * Each group is a set of pads already joined by copper, so no airwire is needed
 * inside it. The distance between two groups is the closest approach between
 * any of their members, and that closest pair is what gets drawn — using a
 * group representative instead would produce airwires that skip past the pad
 * they should obviously connect to.
 */
function spanningEdges<T extends { xMm: number; yMm: number }>(groups: T[][]): [T, T][] {
  if (groups.length < 2) return [];

  /** Closest member pair between two groups, with its squared distance. */
  const closest = (a: T[], b: T[]): { d2: number; pair: [T, T] } => {
    let best = Infinity;
    let pair: [T, T] = [a[0]!, b[0]!];
    for (const p of a) {
      for (const q of b) {
        const dx = p.xMm - q.xMm;
        const dy = p.yMm - q.yMm;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) {
          best = d2;
          pair = [p, q];
        }
      }
    }
    return { d2: best, pair };
  };

  const inTree = [groups[0]!];
  const remaining = groups.slice(1);
  const edges: [T, T][] = [];

  while (remaining.length > 0) {
    let bestDist = Infinity;
    let bestRemaining = 0;
    let bestPair: [T, T] | null = null;
    for (let t = 0; t < inTree.length; t++) {
      for (let r = 0; r < remaining.length; r++) {
        const { d2, pair } = closest(inTree[t]!, remaining[r]!);
        if (d2 < bestDist) {
          bestDist = d2;
          bestRemaining = r;
          bestPair = pair;
        }
      }
    }
    const [next] = remaining.splice(bestRemaining, 1);
    if (bestPair) edges.push(bestPair);
    inTree.push(next!);
  }

  return edges;
}

/**
 * Nets from the schematic plus the airwires that show them on the board, and
 * an honest account of what couldn't be connected.
 */
/**
 * Net name per copper-graph pad key. Zones need this to know which pads they
 * pour around, and DRC needs it to tell a short from an intended connection.
 */
export function padNetMap(circuit: CircuitDoc, pcb: PcbDoc): Map<string, string> {
  const byPadId = netsByPad(buildNets(circuit), pcb);
  const out = new Map<string, string>();
  for (const [key, net] of byPadId) {
    const sep = key.lastIndexOf(":");
    out.set(padKey(key.slice(0, sep), key.slice(sep + 1)), net);
  }
  return out;
}

export function buildRatsnest(
  circuit: CircuitDoc,
  pcb: PcbDoc,
  /** Pass a graph you already built (the canvas needs one for DRC too). */
  copper?: CopperGraph,
): Ratsnest {
  const nets = buildNets(circuit);
  const graph = copper ?? buildCopperGraph(pcb, padNetMap(circuit, pcb));

  const partIds = new Set(circuit.parts.map((p) => p.id));
  const byPartId = new Map<string, PcbFootprint>();
  const danglingFootprints: RatsnestIssues["danglingFootprints"] = [];
  for (const fp of pcb.footprints) {
    if (!fp.partId) continue;
    if (!partIds.has(fp.partId)) {
      danglingFootprints.push({ refDes: fp.refDes, partId: fp.partId });
      continue;
    }
    // First footprint wins if two claim the same part; the second is reported
    // as dangling so the duplicate is visible rather than silently ignored.
    if (byPartId.has(fp.partId)) danglingFootprints.push({ refDes: fp.refDes, partId: fp.partId });
    else byPartId.set(fp.partId, fp);
  }

  const unlinkedParts = new Map<string, string>();
  const unmappedPins: RatsnestIssues["unmappedPins"] = [];
  const airwires: Airwire[] = [];
  let routedCount = 0;
  let totalConnections = 0;

  for (const net of nets) {
    const endpoints: {
      footprintId: string;
      refDes: string;
      pin: string;
      xMm: number;
      yMm: number;
    }[] = [];

    for (const node of net.nodes) {
      const fp = byPartId.get(node.partId);
      if (!fp) {
        if (!unlinkedParts.has(node.partId)) {
          const part = circuit.parts.find((p) => p.id === node.partId);
          unlinkedParts.set(node.partId, part?.label ?? part?.type ?? node.partId);
        }
        continue;
      }
      const pad = resolvePad(fp, node.pin);
      if (!pad) {
        unmappedPins.push({ refDes: fp.refDes, partId: node.partId, pin: node.pin });
        continue;
      }
      const at = padWorldPosition(fp, pad);
      endpoints.push({
        footprintId: fp.id,
        refDes: fp.refDes,
        pin: pad.pin,
        xMm: at.xMm,
        yMm: at.yMm,
      });
    }

    // Pads the copper already ties together need no airwire between them, so
    // group by connected component and span only the gaps that remain.
    const byComponent = new Map<string, typeof endpoints>();
    for (const ep of endpoints) {
      const root = graph.set.find(padKey(ep.footprintId, ep.pin));
      const group = byComponent.get(root);
      if (group) group.push(ep);
      else byComponent.set(root, [ep]);
    }
    const groups = [...byComponent.values()];

    // A net with n pads needs n-1 connections; k groups leave k-1 unrouted.
    if (endpoints.length > 0) {
      totalConnections += endpoints.length - 1;
      routedCount += endpoints.length - groups.length;
    }

    for (const [from, to] of spanningEdges(groups)) {
      airwires.push({ net: net.name, from, to });
    }
  }

  return {
    nets,
    airwires,
    issues: {
      unlinkedParts: [...unlinkedParts].map(([partId, label]) => ({ partId, label })),
      unmappedPins,
      danglingFootprints,
    },
    routedCount,
    totalConnections,
  };
}

/**
 * Net name per `${footprintId}:${padPin}`, for inspector and hover labels.
 * Takes already-computed nets so callers that also need the ratsnest don't
 * walk the schematic twice.
 */
export function netsByPad(nets: Net[], pcb: PcbDoc): Map<string, string> {
  const out = new Map<string, string>();
  // Match buildRatsnest's first-owner policy; duplicate links are reported there.
  const byPartId = new Map<string, PcbFootprint>();
  for (const footprint of pcb.footprints) {
    if (footprint.partId && !byPartId.has(footprint.partId))
      byPartId.set(footprint.partId, footprint);
  }
  for (const net of nets) {
    for (const node of net.nodes) {
      const fp = byPartId.get(node.partId);
      if (!fp) continue;
      const pad = resolvePad(fp, node.pin);
      if (pad) out.set(`${fp.id}:${pad.pin}`, net.name);
    }
  }
  return out;
}
