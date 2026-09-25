/**
 * Impact analysis: "I changed this — what else is now suspect?"
 *
 * This is the question FOUNDRY exists to answer, and the reason the product
 * graph exists at all. A breadth-first walk from the changed node, following
 * edges in the dependency direction, returning every reachable artifact with
 * the ORDERED PATH that explains why it is there. The path is not decoration:
 * "the enclosure is affected" is a claim, and "the enclosure is affected
 * because the battery is housed in it" is evidence. Only the second is worth
 * showing an engineer.
 *
 * Why in-memory rather than a recursive CTE. A branch is a few hundred nodes
 * and a couple of thousand edges, so loading the edge table costs one indexed
 * scan and traversing it costs microseconds — scale is not the deciding factor
 * either way. What decides it is that this is not plain reachability: it needs
 * per-kind propagation rules, confidence that decays along a path, a depth
 * cap, cycle detection that returns the actual cycle, and shortest-path
 * reconstruction for every result. In SQL that is an array_agg of composite
 * types with a NOT (x = ANY(path)) guard, testable only against a live
 * database — while every other test in this repo mocks the database. Here it
 * is a pure function over a fixture, which is what lets the correctness claim
 * be tested at all.
 *
 * Breadth-first, not depth-first: BFS reaches each node by its shortest path
 * first, and the shortest path is the one worth showing.
 */

import type {
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  ProductEdgeKind,
  ProductNodeKind,
} from "./types";

export type ImpactHop = {
  kind: ProductEdgeKind;
  fromRefKey: string;
  fromLabel: string;
  toRefKey: string;
  toLabel: string;
  rule?: string | null;
  evidence?: string | null;
};

/**
 * How much to trust that this artifact is really affected.
 * `review` is a structural certainty; `possible` is a chain of guesses.
 */
export type ImpactSeverity = "review" | "likely" | "possible";

export type ImpactNode = {
  refKey: string;
  nodeId: string;
  kind: ProductNodeKind;
  label: string;
  /** Hops from the changed node. 1 = directly connected. */
  depth: number;
  /** Shortest path from the changed node to this one. */
  path: ImpactHop[];
  /** One sentence naming the last link, e.g. "houses the LiPo cell". */
  reason: string;
  /** Product of edge confidences along the path. */
  confidence: number;
  severity: ImpactSeverity;
};

export type ImpactOptions = {
  maxDepth?: number;
  minConfidence?: number;
  maxResults?: number;
};

/**
 * Six hops. The demo's longest real chain — battery to firmware via the MCU,
 * its schematic part, and a net — is four, so this leaves headroom without
 * letting the panel degenerate into a list of the entire project.
 */
export const DEFAULT_MAX_DEPTH = 6;
/**
 * Three chained heuristics (0.6 x 0.6 x 0.6 = 0.216) fall below this and drop
 * out. That is the intent: a guess about a guess about a guess is noise, and
 * an impact panel that cries wolf gets ignored.
 */
export const DEFAULT_MIN_CONFIDENCE = 0.25;
export const DEFAULT_MAX_RESULTS = 100;

/**
 * How each edge kind reads in a sentence, from the DEPENDENT's point of view —
 * these render the `reason` on an affected node, so they describe what the
 * affected thing is to the thing that changed. Kept in one map so the wording
 * is consistent everywhere and can be snapshot-tested.
 */
const REASON_TEMPLATES: Record<ProductEdgeKind, (hop: ImpactHop) => string> = {
  POWERS: (h) => `is powered by ${h.fromLabel}`,
  REALIZED_BY: (h) => `realizes ${h.fromLabel}`,
  CONNECTS: (h) => `is wired to ${h.fromLabel}`,
  // DRIVES runs pin -> firmware, so the dependent is the firmware.
  DRIVES: (h) => `drives ${h.fromLabel}`,
  HOUSES: (h) => `houses ${h.fromLabel}`,
  CONTAINS: (h) => `contains ${h.fromLabel}`,
  SATISFIES: (h) => `is satisfied by ${h.fromLabel}`,
  VERIFIED_BY: (h) => `verifies ${h.fromLabel}`,
  IMPLEMENTED_BY: (h) => `implements ${h.fromLabel}`,
  DEPENDS_ON: (h) => `depends on ${h.fromLabel}`,
  DERIVED_FROM: (h) => `was derived from ${h.fromLabel}`,
  MITIGATES: (h) => `is mitigated by ${h.fromLabel}`,
};

const severityFor = (confidence: number): ImpactSeverity =>
  confidence >= 0.9 ? "review" : confidence >= 0.5 ? "likely" : "possible";

type Adjacency = Map<string, GraphEdge[]>;

/** Adjacency keyed by refKey. `forward` follows dependency -> dependent. */
function buildAdjacency(edges: GraphEdge[], direction: "forward" | "reverse"): Adjacency {
  const adjacency: Adjacency = new Map();
  for (const edge of edges) {
    const key = direction === "forward" ? edge.from : edge.to;
    const bucket = adjacency.get(key);
    if (bucket) bucket.push(edge);
    else adjacency.set(key, [edge]);
  }
  return adjacency;
}

function hopFor(edge: GraphEdge, nodes: Map<string, GraphNode>): ImpactHop {
  return {
    kind: edge.kind,
    fromRefKey: edge.from,
    fromLabel: nodes.get(edge.from)?.label ?? edge.from,
    toRefKey: edge.to,
    toLabel: nodes.get(edge.to)?.label ?? edge.to,
    rule: edge.rule,
    evidence: edge.evidence,
  };
}

/** Shared BFS. `direction` picks impact (forward) or provenance (reverse). */
function traverse(
  graph: GraphSnapshot,
  rootRefKey: string,
  direction: "forward" | "reverse",
  opts: ImpactOptions = {},
): ImpactNode[] {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const maxResults = opts.maxResults ?? DEFAULT_MAX_RESULTS;

  const nodes = new Map(graph.nodes.map((n) => [n.refKey, n]));
  if (!nodes.has(rootRefKey)) return [];

  const adjacency = buildAdjacency(graph.edges, direction);
  // Marking the root visited both excludes it from its own results and makes
  // a cycle that returns to it terminate rather than reporting it as affected.
  const visited = new Set<string>([rootRefKey]);
  const results: ImpactNode[] = [];

  let frontier: { refKey: string; path: ImpactHop[]; confidence: number }[] = [
    { refKey: rootRefKey, path: [], confidence: 1 },
  ];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: typeof frontier = [];
    for (const current of frontier) {
      for (const edge of adjacency.get(current.refKey) ?? []) {
        const nextRefKey = direction === "forward" ? edge.to : edge.from;
        // First arrival is the shortest path, so a later one is never better.
        if (visited.has(nextRefKey)) continue;
        const confidence = current.confidence * edge.confidence;
        if (confidence < minConfidence) continue;
        const node = nodes.get(nextRefKey);
        if (!node) continue;

        visited.add(nextRefKey);
        const hop = hopFor(edge, nodes);
        const path = [...current.path, hop];
        results.push({
          refKey: nextRefKey,
          nodeId: node.id,
          kind: node.kind,
          label: node.label,
          depth,
          path,
          reason: REASON_TEMPLATES[edge.kind](hop),
          confidence,
          severity: severityFor(confidence),
        });
        next.push({ refKey: nextRefKey, path, confidence });
      }
    }
    frontier = next;
  }

  results.sort(
    (a, b) => a.depth - b.depth || b.confidence - a.confidence || a.label.localeCompare(b.label),
  );
  return results.slice(0, maxResults);
}

/**
 * Everything downstream of a change, nearest and most certain first.
 * Excludes the changed node itself.
 */
export function impactFrom(
  graph: GraphSnapshot,
  rootRefKey: string,
  opts: ImpactOptions = {},
): ImpactNode[] {
  return traverse(graph, rootRefKey, "forward", opts);
}

/**
 * "Why does this exist?" — the same walk against the arrows, so the answer is
 * the set of things this artifact was created to serve.
 *
 * Shallower than impact by default: provenance is an explanation a person
 * reads, and three hops of it is already a paragraph.
 */
export function provenanceOf(
  graph: GraphSnapshot,
  refKey: string,
  opts: ImpactOptions = {},
): {
  node: GraphNode | null;
  justifiedBy: ImpactNode[];
} {
  const node = graph.nodes.find((n) => n.refKey === refKey) ?? null;
  return {
    node,
    justifiedBy: traverse(graph, refKey, "reverse", { maxDepth: 3, ...opts }),
  };
}

/**
 * Every cycle among edges of the given kinds, each as an ordered list of
 * refKeys that returns to its start.
 *
 * Returns the cycles themselves rather than a boolean because the task
 * dependency check has to tell the user WHICH tasks form the loop — "there is
 * a circular dependency somewhere" is not actionable.
 */
export function findCycles(graph: GraphSnapshot, kinds: readonly ProductEdgeKind[]): string[][] {
  const kindSet = new Set(kinds);
  const adjacency = buildAdjacency(
    graph.edges.filter((e) => kindSet.has(e.kind)),
    "forward",
  );

  const cycles: string[][] = [];
  const seenCycles = new Set<string>();
  // Standard iterative white/grey/black DFS: a hit on a grey node is a back
  // edge, and the cycle is the slice of the current stack from that node on.
  const state = new Map<string, "grey" | "black">();

  for (const start of graph.nodes.map((n) => n.refKey)) {
    if (state.has(start)) continue;
    const stack: { refKey: string; edgeIndex: number }[] = [{ refKey: start, edgeIndex: 0 }];
    state.set(start, "grey");

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (!top) break;
      const edges = adjacency.get(top.refKey) ?? [];
      const nextEdge = edges[top.edgeIndex++];
      if (!nextEdge) {
        state.set(top.refKey, "black");
        stack.pop();
        continue;
      }
      const nextRefKey = nextEdge.to;
      const nextState = state.get(nextRefKey);
      if (nextState === "grey") {
        const at = stack.findIndex((frame) => frame.refKey === nextRefKey);
        if (at !== -1) {
          const cycle = stack.slice(at).map((frame) => frame.refKey);
          // Rotate to a canonical start so the same loop found from two entry
          // points is reported once.
          const smallest = [...cycle].sort()[0]!;
          const min = cycle.indexOf(smallest);
          const canonical = [...cycle.slice(min), ...cycle.slice(0, min)];
          const signature = canonical.join(">");
          if (!seenCycles.has(signature)) {
            seenCycles.add(signature);
            cycles.push(canonical);
          }
        }
      } else if (nextState === undefined) {
        state.set(nextRefKey, "grey");
        stack.push({ refKey: nextRefKey, edgeIndex: 0 });
      }
    }
  }
  return cycles;
}

/** Renders a path as a breadcrumb: "Battery > ESP32 > net 5V > src/main.cpp". */
export function renderPath(impact: ImpactNode): string {
  const first = impact.path[0];
  if (!first) return impact.label;
  return [first.fromLabel, ...impact.path.map((hop) => hop.toLabel)].join(" > ");
}
