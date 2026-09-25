/**
 * Lays an impact result out as a small left-to-right graph.
 *
 * The list in the impact panel is the primary view; this is the picture of it.
 * Columns are hops from the change, so reading left to right is reading cause
 * to consequence. Deterministic on purpose — the same impact always draws the
 * same picture, so a screenshot in a report matches what someone sees live.
 *
 * Wiring intermediates (nets, pins, schematic parts) can be hidden. When they
 * are, edges collapse across them rather than disappearing: the battery still
 * visibly connects to the firmware, with the edge noting how many links it
 * passed through.
 */

import type { ImpactHop, ImpactNode } from "./impact";

export const STRUCTURAL_KINDS: ReadonlySet<string> = new Set([
  "CIRCUIT_PART",
  "NET",
  "MCU_PIN",
  "FOOTPRINT",
]);

/** Beyond this the picture stops explaining anything; the list still has it all. */
export const MAX_GRAPH_NODES = 30;

export const COLUMN_WIDTH = 220;
export const ROW_HEIGHT = 64;

export type ImpactGraphNode = {
  id: string;
  label: string;
  kind: string;
  column: number;
  x: number;
  y: number;
  severity: ImpactNode["severity"] | "root";
};

export type ImpactGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: ImpactHop["kind"];
  /** Links hidden inside this edge because their nodes are hidden. */
  collapsed: number;
};

export type ImpactGraphLayout = {
  nodes: ImpactGraphNode[];
  edges: ImpactGraphEdge[];
  /** Results left out to keep the picture readable. */
  omitted: number;
};

export function layoutImpactGraph(
  root: { refKey: string; label: string },
  impacted: ImpactNode[],
  opts: { includeStructural?: boolean; maxNodes?: number } = {},
): ImpactGraphLayout {
  const visible = (kind: string) => opts.includeStructural || !STRUCTURAL_KINDS.has(kind);
  const candidates = impacted.filter((n) => visible(n.kind));
  const cap = (opts.maxNodes ?? MAX_GRAPH_NODES) - 1; // one slot is the root
  // Impact results arrive nearest and most certain first, so the cap keeps
  // what matters most.
  const shown = candidates.slice(0, cap);
  const shownKeys = new Set([root.refKey, ...shown.map((n) => n.refKey)]);

  const edges = new Map<string, ImpactGraphEdge>();
  const column = new Map<string, number>([[root.refKey, 0]]);

  for (const node of shown) {
    // Walk the path, keeping only the stops that are drawn.
    let previous = root.refKey;
    let hidden = 0;
    let depth = 0;
    for (const hop of node.path) {
      if (!shownKeys.has(hop.toRefKey)) {
        hidden++;
        continue;
      }
      depth++;
      const id = `${previous}->${hop.toRefKey}`;
      if (!edges.has(id)) {
        edges.set(id, {
          id,
          source: previous,
          target: hop.toRefKey,
          kind: hop.kind,
          collapsed: hidden,
        });
      }
      column.set(hop.toRefKey, Math.min(column.get(hop.toRefKey) ?? Infinity, depth));
      previous = hop.toRefKey;
      hidden = 0;
    }
  }

  const rows = new Map<number, { refKey: string; label: string }[]>();
  const byKey = new Map(shown.map((n) => [n.refKey, n]));
  for (const [refKey, col] of column) {
    const label = refKey === root.refKey ? root.label : (byKey.get(refKey)?.label ?? refKey);
    const bucket = rows.get(col) ?? [];
    bucket.push({ refKey, label });
    rows.set(col, bucket);
  }

  const nodes: ImpactGraphNode[] = [];
  for (const [col, entries] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    entries.sort((a, b) => a.label.localeCompare(b.label));
    // Centre each column vertically so the picture reads as a fan, not a staircase.
    const offset = -((entries.length - 1) * ROW_HEIGHT) / 2;
    entries.forEach((entry, row) => {
      const impact = byKey.get(entry.refKey);
      nodes.push({
        id: entry.refKey,
        label: entry.label,
        kind: impact?.kind ?? "ROOT",
        column: col,
        x: col * COLUMN_WIDTH,
        y: offset + row * ROW_HEIGHT,
        severity: impact?.severity ?? "root",
      });
    });
  }

  return { nodes, edges: [...edges.values()], omitted: candidates.length - shown.length };
}
