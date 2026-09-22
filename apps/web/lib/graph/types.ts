/**
 * The product graph's vocabulary — the one interface every other graph module
 * agrees on.
 *
 * The central idea is that the graph is an INDEX, not a store. A node does not
 * hold a requirement or a CAD part; it holds a `refKey` that ADDRESSES one,
 * wherever that thing already lives. Requirements are rows, CAD parts are
 * entries inside a DesignDoc JSON blob, and nets do not exist at rest at all —
 * they are computed by `buildNets()` every time. A key made of a table name and
 * a row id could only ever address the first of those three. A namespaced
 * string addresses all of them, which is why `refKey` is a string and why it is
 * the join key for everything downstream.
 *
 * TASK, RISK and DECISION are the exception: nothing else in the schema stores
 * them, so for those kinds the node is the record and the payload lives in
 * `data`.
 */

export const PRODUCT_NODE_KINDS = [
  "REQUIREMENT",
  "COMPONENT",
  "CHECK",
  "FIRMWARE_FILE",
  "CIRCUIT_PART",
  "NET",
  "FOOTPRINT",
  "MCU_PIN",
  "CAD_PART",
  "CAD_ASSEMBLY",
  "BRIEF",
  "TASK",
  "RISK",
  "DECISION",
] as const;
export type ProductNodeKind = (typeof PRODUCT_NODE_KINDS)[number];

/**
 * DIRECTION CONVENTION — the single most important line in this file.
 *
 *   `from` is the DEPENDENCY. `to` is the DEPENDENT.
 *
 *   "what does changing X affect?"  =>  walk from -> to   (impactFrom)
 *   "why does this exist?"          =>  walk to -> from   (provenanceOf)
 *
 * Read every edge as "<from> is depended on by <to>". A battery POWERS an MCU,
 * so the battery is `from`: change the battery and the MCU is affected.
 *
 * Direction follows the DEPENDENCY, not the English reading of the kind's
 * name. Firmware drives a pin, but it is the firmware that has to change when
 * the pin is rewired — so DRIVES runs MCU_PIN -> FIRMWARE_FILE. Likewise a net
 * is formed by the parts on it (CIRCUIT_PART -> NET) while an MCU pin's
 * meaning is set by the net it sits on (NET -> MCU_PIN). Together those give
 * the chain that matters: move a part, and the firmware driving the pin on its
 * net is flagged.
 */
export const PRODUCT_EDGE_KINDS = [
  "SATISFIES",
  "VERIFIED_BY",
  "IMPLEMENTED_BY",
  "REALIZED_BY",
  "CONNECTS",
  "DRIVES",
  "HOUSES",
  "CONTAINS",
  "POWERS",
  "DEPENDS_ON",
  "DERIVED_FROM",
  "MITIGATES",
] as const;
export type ProductEdgeKind = (typeof PRODUCT_EDGE_KINDS)[number];

export const GRAPH_ORIGINS = ["DERIVED", "USER", "AGENT", "IMPORT"] as const;
export type GraphOrigin = (typeof GRAPH_ORIGINS)[number];

/**
 * Edge kinds the deriver must never produce.
 *
 * Each of these encodes engineering judgement that is not recoverable from the
 * data: which component satisfies which requirement, which task implements
 * which requirement, which risk mitigates what. A heuristic would guess, and a
 * guess presented as a derived fact is worse than an absent edge. These come
 * only from a human or from the copilot's `link_nodes`, and they carry the
 * author's rationale in `evidence`.
 */
export const AUTHORED_ONLY_EDGE_KINDS: readonly ProductEdgeKind[] = [
  "SATISFIES",
  "IMPLEMENTED_BY",
  "DEPENDS_ON",
  "DERIVED_FROM",
  "MITIGATES",
];

export type GraphNode = {
  /** Database id. Empty string for a freshly derived node not yet persisted. */
  id: string;
  kind: ProductNodeKind;
  refKey: string;
  refId?: string | null;
  label: string;
  data?: Record<string, unknown>;
  origin: GraphOrigin;
  originDetail?: string | null;
  contentHash?: string | null;
  staleAt?: Date | null;
  staleReason?: string | null;
  staleFromId?: string | null;
  staleDepth?: number | null;
  staleConfidence?: number | null;
  staleContentHash?: string | null;
  reviewedAt?: Date | null;
};

export type GraphEdge = {
  id: string;
  kind: ProductEdgeKind;
  /** refKey of the dependency. */
  from: string;
  /** refKey of the dependent. */
  to: string;
  origin: GraphOrigin;
  rule?: string | null;
  /** 1.0 = exact structural link; below that it is a heuristic. */
  confidence: number;
  evidence?: string | null;
};

export type GraphSnapshot = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/** A node the deriver produced, before it has a database id. */
export type DerivedNode = Omit<GraphNode, "id"> & { id?: string };
/** An edge the deriver produced, before it has a database id. */
export type DerivedEdge = Omit<GraphEdge, "id"> & { id?: string };

// ---------- refKey construction and parsing ----------
//
// One function per kind rather than a generic builder, so a caller cannot pass
// a CAD path where a requirement id belongs and have it silently typecheck.

/** Normalises a reference designator so "r1", "R1" and " R1 " are one part. */
export const normalizeRefDes = (refDes: string) => refDes.trim().toUpperCase();

export const requirementKey = (id: string) => `requirement:${id}`;
export const componentKey = (id: string) => `component:${id}`;
export const checkKey = (id: string) => `check:${id}`;
export const codeFileKey = (id: string) => `codefile:${id}`;
export const briefKey = (id: string) => `brief:${id}`;
export const circuitPartKey = (partId: string) => `circuitpart:${partId}`;
export const netKey = (netName: string) => `net:${netName}`;
export const footprintKey = (boardIndex: number, refDes: string) =>
  `footprint:${boardIndex}:${normalizeRefDes(refDes)}`;
export const mcuPinKey = (mcuId: string, pin: string) => `pin:${mcuId}:${pin}`;
export const cadPartKey = (path: string) => `cadpart:${path}`;
export const cadAssemblyKey = (path: string) => `cadassembly:${path}`;
export const taskKey = (id: string) => `task:${id}`;
export const riskKey = (id: string) => `risk:${id}`;
export const decisionKey = (id: string) => `decision:${id}`;

/**
 * Splits a refKey into its namespace and the rest.
 *
 * Only the FIRST colon separates, because the remainder legitimately contains
 * colons (`pin:uno:13`) and slashes (`cadpart:parts/case.kcl`).
 */
export function parseRefKey(refKey: string): { namespace: string; rest: string } | null {
  const at = refKey.indexOf(":");
  if (at <= 0 || at === refKey.length - 1) return null;
  return { namespace: refKey.slice(0, at), rest: refKey.slice(at + 1) };
}

const NAMESPACE_TO_KIND: Record<string, ProductNodeKind> = {
  requirement: "REQUIREMENT",
  component: "COMPONENT",
  check: "CHECK",
  codefile: "FIRMWARE_FILE",
  circuitpart: "CIRCUIT_PART",
  net: "NET",
  footprint: "FOOTPRINT",
  pin: "MCU_PIN",
  cadpart: "CAD_PART",
  cadassembly: "CAD_ASSEMBLY",
  brief: "BRIEF",
  task: "TASK",
  risk: "RISK",
  decision: "DECISION",
};

/** The node kind a refKey addresses, or null if the namespace is unknown. */
export function kindForRefKey(refKey: string): ProductNodeKind | null {
  const parsed = parseRefKey(refKey);
  return parsed ? (NAMESPACE_TO_KIND[parsed.namespace] ?? null) : null;
}

/**
 * The row id a refKey points at, for the kinds backed by a whole row.
 * Null for sub-document and computed nodes, which have no row to point at.
 */
export function refIdForRefKey(refKey: string): string | null {
  const parsed = parseRefKey(refKey);
  if (!parsed) return null;
  const rowBacked = ["requirement", "component", "check", "codefile", "brief"];
  return rowBacked.includes(parsed.namespace) ? parsed.rest : null;
}

/**
 * Node kinds a person actually opens and revises.
 *
 * Impact analysis reaches further than this — through schematic parts, nets,
 * pins and footprints — and it should, because those are how the connection
 * from a battery to a firmware file is established in the first place. But
 * they are intermediates, not work: nobody revises "net LED_A" in response to
 * a battery swap; they revise the firmware at the end of that chain, and the
 * net follows from the schematic edit that caused it.
 *
 * So the traversal reports everything and the STALE FLAG lands only on these.
 * Marking twenty nets for review is how a review queue becomes something
 * people dismiss without reading.
 */
export const REVIEWABLE_NODE_KINDS: ReadonlySet<ProductNodeKind> = new Set<ProductNodeKind>([
  "REQUIREMENT",
  "COMPONENT",
  "CHECK",
  "FIRMWARE_FILE",
  "CAD_PART",
  "CAD_ASSEMBLY",
  "BRIEF",
  "TASK",
  "RISK",
  "DECISION",
]);

/** Index a snapshot by refKey. Used by every consumer, so it lives here. */
export function indexNodes(snapshot: GraphSnapshot): Map<string, GraphNode> {
  return new Map(snapshot.nodes.map((n) => [n.refKey, n]));
}
