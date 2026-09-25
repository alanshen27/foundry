/**
 * "What changed between these two branches?"
 *
 * Every other graph module answers questions within one branch. This is the
 * one that looks across two — the feature no competitor in this space offers
 * in this shape: a diff that spans requirements, schematic, PCB, CAD, firmware
 * and checks together, because they all live in one graph instead of five
 * separate tools.
 *
 * The diff is pure and synchronous, same discipline as `impact.ts` and
 * `checks.ts`: two `GraphSnapshot`s in, a `BranchDiff` out, no database, no
 * network. Branches have no stored parent/base relationship (see
 * `ProjectBranch` in the schema), so this makes no assumption about which
 * snapshot is "older" — A and B are just two branches somebody picked.
 */

import { indexNodes, type GraphEdge, type GraphNode, type GraphSnapshot } from "./types";

export type NodeDiffStatus = "added" | "removed" | "changed";

export type NodeDiff = {
  refKey: string;
  kind: GraphNode["kind"];
  status: NodeDiffStatus;
  /** The label to show — B's if it exists (the more current name), else A's. */
  label: string;
};

export type EdgeDiffStatus = "added" | "removed";

export type EdgeDiff = {
  /** `${kind}::${from}::${to}` — stable across branches since it's refKeys, not row ids. */
  key: string;
  kind: GraphEdge["kind"];
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  status: EdgeDiffStatus;
};

export type BranchDiff = {
  nodes: NodeDiff[];
  edges: EdgeDiff[];
  summary: { added: number; removed: number; changed: number };
};

/** Stable stringify — sorts object keys recursively so key order never causes a false "changed". */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Whether a node's content is meaningfully the same on both branches.
 *
 * Most kinds carry a `contentHash` computed from the artifact they index, so
 * comparing that is exact and cheap. TASK, RISK and DECISION are the
 * exception — the node IS the record, and nothing computes a hash for it — so
 * those fall back to comparing `label` and `data` directly. A node missing a
 * hash on one branch but not the other is treated as changed rather than
 * silently skipped, since that mismatch is itself informative.
 */
function nodesEqual(a: GraphNode, b: GraphNode): boolean {
  if (a.contentHash != null || b.contentHash != null) {
    return a.contentHash === b.contentHash;
  }
  return a.label === b.label && stableStringify(a.data ?? {}) === stableStringify(b.data ?? {});
}

function edgeKey(e: Pick<GraphEdge, "kind" | "from" | "to">): string {
  return `${e.kind}::${e.from}::${e.to}`;
}

/**
 * Diffs two branch snapshots of the same project.
 *
 * Nodes match by `refKey`, which addresses an artifact by name/path rather
 * than by database row id, so it means the same thing on both branches.
 * Edges have no identity of their own beyond their endpoints and kind (the
 * schema's own `@@unique([fromId, toId, kind])` says as much), so they match
 * on `(kind, from, to)`. An edge's confidence/evidence/rule can differ across
 * branches without being reported — those are provenance, not something a
 * diff view needs to call a "change".
 */
export function diffGraphs(a: GraphSnapshot, b: GraphSnapshot): BranchDiff {
  const aNodes = indexNodes(a);
  const bNodes = indexNodes(b);
  const allRefKeys = new Set([...aNodes.keys(), ...bNodes.keys()]);

  const nodes: NodeDiff[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const refKey of allRefKeys) {
    const an = aNodes.get(refKey) ?? null;
    const bn = bNodes.get(refKey) ?? null;
    if (an && bn) {
      if (nodesEqual(an, bn)) continue;
      changed++;
      nodes.push({ refKey, kind: bn.kind, status: "changed", label: bn.label });
    } else if (bn) {
      added++;
      nodes.push({ refKey, kind: bn.kind, status: "added", label: bn.label });
    } else if (an) {
      removed++;
      nodes.push({ refKey, kind: an.kind, status: "removed", label: an.label });
    }
  }

  const aEdges = new Map(a.edges.map((e) => [edgeKey(e), e]));
  const bEdges = new Map(b.edges.map((e) => [edgeKey(e), e]));
  const allEdgeKeys = new Set([...aEdges.keys(), ...bEdges.keys()]);

  const labelOf = (refKey: string) =>
    bNodes.get(refKey)?.label ?? aNodes.get(refKey)?.label ?? refKey;
  const edges: EdgeDiff[] = [];
  for (const key of allEdgeKeys) {
    const ae = aEdges.get(key) ?? null;
    const be = bEdges.get(key) ?? null;
    if (ae && be) continue; // unchanged — endpoints and kind matched, that's the whole identity.
    const e = (be ?? ae)!;
    edges.push({
      key,
      kind: e.kind,
      from: e.from,
      to: e.to,
      fromLabel: labelOf(e.from),
      toLabel: labelOf(e.to),
      status: be ? "added" : "removed",
    });
  }

  return { nodes, edges, summary: { added, removed, changed } };
}
