/**
 * Splitting one schematic across several boards.
 *
 * A group is a rectangle drawn on the schematic canvas; the parts inside it
 * become one physical board. That makes two questions answerable that a single
 * flat schematic cannot express:
 *
 *   - which parts belong on which board, and
 *   - which nets leave a board, because a net whose pins sit in two different
 *     groups cannot be a copper trace. It has to become a connector on each
 *     board and a wire between them, and forgetting one is the classic way a
 *     multi-board design fails at assembly.
 *
 * Membership is spatial (see CircuitGroup), so this module never mutates the
 * schematic — it only reads geometry and reports what follows from it.
 */

import type { CircuitDoc, CircuitGroup, CircuitPart } from "@/lib/circuit/catalog";
import { buildNets, type Net } from "@/lib/pcb/netlist";

/** Part centres are a point; a part is in the first group that contains it. */
export function groupOfPart(
  groups: CircuitGroup[],
  part: Pick<CircuitPart, "x" | "y">,
): CircuitGroup | null {
  for (const g of groups) {
    if (part.x >= g.x && part.x <= g.x + g.w && part.y >= g.y && part.y <= g.y + g.h) {
      return g;
    }
  }
  return null;
}

export type BoardSlice = {
  group: CircuitGroup;
  partIds: string[];
  /** Nets whose every pin sits on this board — routable as copper. */
  internalNets: string[];
  /** Nets shared with another board — each needs a connector here. */
  crossingNets: string[];
};

export type NetCrossing = {
  net: string;
  /** Groups this net touches, in document order. */
  groupIds: string[];
  groupLabels: string[];
  /** True when the net also reaches a part outside every group. */
  touchesUngrouped: boolean;
};

export type BoardPartition = {
  slices: BoardSlice[];
  /** Parts in no group at all. */
  ungroupedPartIds: string[];
  /** Nets spanning more than one board — the interconnect the design needs. */
  crossings: NetCrossing[];
  /** Group pairs whose rectangles intersect, where membership is ambiguous. */
  overlaps: { aId: string; bId: string; aLabel: string; bLabel: string }[];
};

function rectsOverlap(a: CircuitGroup, b: CircuitGroup): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Which board each part sits on, and which nets have to cross between them.
 * Pass `nets` when the caller already built them, so a schematic is not walked
 * twice on the same render.
 */
export function partitionBoards(circuit: CircuitDoc, nets: Net[] = buildNets(circuit)): BoardPartition {
  const groups = circuit.groups;
  const groupById = new Map(groups.map((g) => [g.id, g]));

  const groupOf = new Map<string, string>();
  const ungroupedPartIds: string[] = [];
  for (const part of circuit.parts) {
    const g = groupOfPart(groups, part);
    if (g) groupOf.set(part.id, g.id);
    else ungroupedPartIds.push(part.id);
  }

  // Per net, the set of boards its pins land on.
  const crossings: NetCrossing[] = [];
  const netsPerGroup = new Map<string, { internal: string[]; crossing: string[] }>();
  for (const g of groups) netsPerGroup.set(g.id, { internal: [], crossing: [] });

  for (const net of nets) {
    const touched = new Set<string>();
    let touchesUngrouped = false;
    for (const node of net.nodes) {
      const gid = groupOf.get(node.partId);
      if (gid) touched.add(gid);
      // A pin on a part that no group contains, or on a part the schematic
      // does not have, leaves the net unassigned rather than crossing.
      else touchesUngrouped = true;
    }

    const ids = groups.map((g) => g.id).filter((id) => touched.has(id));
    if (ids.length > 1) {
      crossings.push({
        net: net.name,
        groupIds: ids,
        groupLabels: ids.map((id) => groupById.get(id)?.label ?? id),
        touchesUngrouped,
      });
      for (const id of ids) netsPerGroup.get(id)!.crossing.push(net.name);
    } else if (ids.length === 1) {
      // Reaching an ungrouped part means the net is not fully on this board,
      // but there is no second board to connect to — report it as internal and
      // let the ungrouped-parts list carry the problem.
      netsPerGroup.get(ids[0]!)!.internal.push(net.name);
    }
  }

  const overlaps: BoardPartition["overlaps"] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i]!;
      const b = groups[j]!;
      if (rectsOverlap(a, b)) {
        overlaps.push({ aId: a.id, bId: b.id, aLabel: a.label, bLabel: b.label });
      }
    }
  }

  return {
    slices: groups.map((group) => ({
      group,
      partIds: circuit.parts.filter((p) => groupOf.get(p.id) === group.id).map((p) => p.id),
      internalNets: netsPerGroup.get(group.id)!.internal,
      crossingNets: netsPerGroup.get(group.id)!.crossing,
    })),
    ungroupedPartIds,
    crossings,
    overlaps,
  };
}

/**
 * The schematic restricted to one board: its parts, plus only the wires with
 * both ends on that board. A crossing net's wire is deliberately dropped —
 * on this board that signal terminates at a connector, so keeping the wire
 * would make the ratsnest demand a trace to a part that is not there.
 */
export function circuitForGroup(circuit: CircuitDoc, groupId: string | null): CircuitDoc {
  if (!groupId) return circuit;
  const group = circuit.groups.find((g) => g.id === groupId);
  if (!group) return circuit;

  const inGroup = new Set(
    circuit.parts.filter((p) => groupOfPart(circuit.groups, p)?.id === groupId).map((p) => p.id),
  );

  return {
    version: 2,
    groups: circuit.groups,
    parts: circuit.parts.filter((p) => inGroup.has(p.id)),
    wires: circuit.wires.filter((w) => inGroup.has(w.from.part) && inGroup.has(w.to.part)),
  };
}
