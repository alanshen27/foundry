/**
 * Deterministic consistency checks that only become possible once the project
 * is a graph.
 *
 * Everything in lib/integration/fit-check.ts checks one artifact against
 * another directly. These check the SHAPE of the project: a requirement nobody
 * verifies, a chip nothing drives, a battery that cannot last as long as the
 * spec demands, a task loop that can never start. None of them are answerable
 * without knowing how the pieces link, which is the whole argument for the
 * graph.
 *
 * Every function here is pure and synchronous. Nothing reads the database,
 * nothing calls the network, and the one function that needs the time takes it
 * as an argument — so each check is a fixture and an assertion, and a defect
 * fixture can prove a check actually fires rather than merely not crashing.
 */

import { hasSubstituteOf, lifecycleStatusOf, partKeyOf } from "@foundry/sourcing";
import type { FitFinding, FitInput } from "@/lib/integration/fit-check";
import { PASSIVE_PART_TYPES } from "./derive";
import { findCycles } from "./impact";
import type { GraphNode, GraphSnapshot, ProductEdgeKind } from "./types";

export type GraphCheckInput = FitInput & { graph: GraphSnapshot };

/** Units that mean "hours" on a requirement, so runtime can be compared. */
const HOUR_UNITS = new Set(["h", "hr", "hrs", "hour", "hours"]);

/** Headroom below which a passing power budget is still worth flagging. */
const POWER_HEADROOM = 1.2;

const linkOf = (node: GraphNode) => ({ refKey: node.refKey, label: node.label });

function outgoing(graph: GraphSnapshot, refKey: string, kind: ProductEdgeKind) {
  return graph.edges.filter((e) => e.from === refKey && e.kind === kind);
}

/** refKeys reachable from `start` within `maxDepth`, ignoring confidence. */
function reachable(graph: GraphSnapshot, start: string, maxDepth: number): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const e of graph.edges) {
    const bucket = adjacency.get(e.from);
    if (bucket) bucket.push(e.to);
    else adjacency.set(e.from, [e.to]);
  }
  const seen = new Set<string>([start]);
  let frontier = [start];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const refKey of frontier) {
      for (const to of adjacency.get(refKey) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        next.push(to);
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * 1. A requirement nobody verifies.
 *
 * This replaces the coarse count in fit-check's checkCoverage, which only
 * fired when a project had no checks at all. Naming the specific requirement
 * is the difference between a statistic and something a person can act on.
 */
export function checkRequirementCoverage(input: GraphCheckInput): FitFinding[] {
  const priorityByRefKey = new Map(
    input.requirements.filter((r) => r.id).map((r) => [`requirement:${r.id}`, r.priority]),
  );

  const uncovered = input.graph.nodes.filter(
    (n) =>
      n.kind === "REQUIREMENT" &&
      outgoing(input.graph, n.refKey, "VERIFIED_BY").length === 0 &&
      priorityByRefKey.get(n.refKey) !== "MAY",
  );
  if (uncovered.length === 0) return [];

  const musts = uncovered.filter((n) => priorityByRefKey.get(n.refKey) === "MUST");
  const findings: FitFinding[] = [];

  if (musts.length > 0) {
    findings.push({
      domain: "CROSS_DOMAIN",
      severity: "error",
      message:
        musts.length === 1
          ? `MUST requirement "${musts[0]!.label}" has nothing that verifies it.`
          : `${musts.length} MUST requirements have nothing that verifies them.`,
      hint: "Add a validation check and set its target path, or link it with link_nodes.",
      nodes: musts.map(linkOf),
    });
  }

  const shoulds = uncovered.filter((n) => priorityByRefKey.get(n.refKey) === "SHOULD");
  if (shoulds.length > 0) {
    findings.push({
      domain: "CROSS_DOMAIN",
      severity: "warning",
      message:
        shoulds.length === 1
          ? `SHOULD requirement "${shoulds[0]!.label}" has nothing that verifies it.`
          : `${shoulds.length} SHOULD requirements have nothing that verifies them.`,
      nodes: shoulds.map(linkOf),
    });
  }
  return findings;
}

/**
 * 2. An active part nothing drives.
 *
 * Warning, never error, and passives are excluded up front — this is the check
 * most likely to be wrong, and a checks panel that flags every resistor is a
 * checks panel nobody reads.
 */
export function checkComponentSoftware(input: GraphCheckInput): FitFinding[] {
  const { graph } = input;
  const partTypeByRefKey = new Map(
    graph.nodes
      .filter((n) => n.kind === "CIRCUIT_PART")
      .map((n) => [n.refKey, String(n.data?.type ?? "")]),
  );
  const disciplineByRefKey = new Map(
    input.components.filter((c) => c.id).map((c) => [`component:${c.id}`, c.discipline]),
  );
  const nodeByRefKey = new Map(graph.nodes.map((n) => [n.refKey, n]));

  const undriven = graph.nodes.filter((node) => {
    if (node.kind !== "COMPONENT") return false;
    if (disciplineByRefKey.get(node.refKey) !== "ELECTRONICS") return false;

    // A component realised by a passive schematic part needs no firmware.
    const realizes = graph.edges.filter((e) => e.from === node.refKey && e.kind === "REALIZED_BY");
    if (realizes.some((e) => PASSIVE_PART_TYPES.has(partTypeByRefKey.get(e.to) ?? ""))) {
      return false;
    }

    // Edges run dependency -> dependent all the way from the BOM line to the
    // code, so a driven part reaches its firmware by walking forward:
    //   component -> schematic part -> net -> MCU pin -> firmware
    // which is four hops. A task implementing the part is nearer. Five hops
    // covers both without letting an unrelated part on a shared power rail
    // count as driven.
    const within = reachable(graph, node.refKey, 5);
    return ![...within].some((refKey) => {
      const reached = nodeByRefKey.get(refKey);
      return reached?.kind === "FIRMWARE_FILE" || reached?.kind === "TASK";
    });
  });

  if (undriven.length === 0) return [];
  return [
    {
      domain: "CROSS_DOMAIN",
      severity: "warning",
      message:
        undriven.length === 1
          ? `"${undriven[0]!.label}" is wired up but no firmware or task drives it.`
          : `${undriven.length} active parts have no firmware or task driving them.`,
      hint: "Write the driver, or link the part to a task with link_nodes if it is handled elsewhere.",
      nodes: undriven.map(linkOf),
    },
  ];
}

/**
 * 3. Power budget.
 *
 * Note the units. The obvious phrasing — "draw exceeds capacity" — compares mA
 * to mAh, which are not comparable. The quantity that means something is
 * RUNTIME: capacity divided by draw, in hours, checked against the operating
 * time the requirements actually ask for.
 *
 * Always labelled ESTIMATED. It is arithmetic over datasheet typicals, not a
 * measurement, and presenting it as verification would be exactly the kind of
 * plausible-looking result this codebase refuses to produce.
 */
export function checkPowerBudget(input: GraphCheckInput): FitFinding[] {
  const findings: FitFinding[] = [];
  const nodeByRefKey = new Map(input.graph.nodes.map((n) => [n.refKey, n]));
  const link = (id: string | undefined) => {
    const n = id ? nodeByRefKey.get(`component:${id}`) : undefined;
    return n ? linkOf(n) : null;
  };

  const sources = input.components.filter((c) => c.capacityMah != null);
  const loads = input.components.filter((c) => c.currentDrawMa != null);
  if (sources.length === 0 || loads.length === 0) return [];

  const capacityMah = sources.reduce((sum, c) => sum + (c.capacityMah ?? 0), 0);
  const totalMa = loads.reduce((sum, c) => sum + (c.currentDrawMa ?? 0) * (c.quantity ?? 1), 0);
  if (totalMa <= 0 || capacityMah <= 0) return [];
  const estHours = capacityMah / totalMa;

  // A check that says nothing when it has nothing to compare against is worse
  // than no check: it reads as a pass.
  const timeRequirements = input.requirements.filter(
    (r) => r.unit && HOUR_UNITS.has(r.unit.trim().toLowerCase()) && r.minValue != null,
  );

  const topLoads = [...loads]
    .sort((a, b) => (b.currentDrawMa ?? 0) - (a.currentDrawMa ?? 0))
    .slice(0, 3);
  const budgetNodes = [
    ...sources.map((s) => link(s.id)),
    ...topLoads.map((l) => link(l.id)),
  ].filter((n): n is { refKey: string; label: string } => n !== null);

  if (timeRequirements.length === 0) {
    findings.push({
      domain: "CROSS_DOMAIN",
      severity: "warning",
      message: `Power budget is ESTIMATED at ${estHours.toFixed(1)} h (${capacityMah} mAh / ${totalMa.toFixed(1)} mA), but no requirement states an operating time to check it against.`,
      hint: "Add a requirement with a minimum value and unit 'h'.",
      nodes: budgetNodes,
    });
  }

  for (const requirement of timeRequirements) {
    const target = requirement.minValue!;
    const requirementNode = requirement.id
      ? nodeByRefKey.get(`requirement:${requirement.id}`)
      : undefined;
    const nodes = requirementNode ? [linkOf(requirementNode), ...budgetNodes] : budgetNodes;

    if (estHours < target) {
      findings.push({
        domain: "CROSS_DOMAIN",
        severity: "error",
        message: `ESTIMATED ${estHours.toFixed(1)} h runtime (${capacityMah} mAh / ${totalMa.toFixed(1)} mA) against a ${target} h ${requirement.priority} requirement.`,
        hint: "Raise capacity, cut draw, or revise the requirement.",
        nodes,
      });
    } else if (estHours < target * POWER_HEADROOM) {
      findings.push({
        domain: "CROSS_DOMAIN",
        severity: "warning",
        message: `ESTIMATED ${estHours.toFixed(1)} h runtime leaves under ${Math.round((POWER_HEADROOM - 1) * 100)}% headroom over the ${target} h requirement.`,
        nodes,
      });
    }
  }

  // The honesty clause: an unknown draw is not a zero draw, and a budget built
  // from partial data must say so or it flatters itself.
  const unknown = input.components.filter(
    (c) => c.discipline === "ELECTRONICS" && c.currentDrawMa == null && c.capacityMah == null,
  );
  if (unknown.length > 0) {
    findings.push({
      domain: "CROSS_DOMAIN",
      severity: "warning",
      message: `Power budget is incomplete — ${unknown.length} electronic part${unknown.length === 1 ? " has" : "s have"} no current figure, so the ESTIMATED runtime is optimistic.`,
      hint: "Set currentDrawMa on those BOM lines from their datasheets.",
      nodes: unknown
        .map((c) => link(c.id))
        .filter((n): n is { refKey: string; label: string } => n !== null),
    });
  }

  return findings;
}

/**
 * 4. Task dependency loops and out-of-order completion.
 *
 * Reports the tasks in the loop, in order. "There is a circular dependency"
 * is not something anyone can act on.
 */
export function checkTaskDependencies(input: GraphCheckInput): FitFinding[] {
  const { graph } = input;
  const findings: FitFinding[] = [];
  const nodeByRefKey = new Map(graph.nodes.map((n) => [n.refKey, n]));

  for (const cycle of findCycles(graph, ["DEPENDS_ON"])) {
    const labels = cycle.map((refKey) => nodeByRefKey.get(refKey)?.label ?? refKey);
    findings.push({
      domain: "CROSS_DOMAIN",
      severity: "error",
      message: `Circular task dependency: ${[...labels, labels[0]].join(" -> ")}.`,
      hint: "Break the loop — none of these tasks can start.",
      nodes: cycle
        .map((refKey) => nodeByRefKey.get(refKey))
        .filter((n): n is GraphNode => n !== undefined)
        .map(linkOf),
    });
  }

  const statusOf = (node: GraphNode | undefined) => String(node?.data?.status ?? "todo");
  const premature = graph.edges
    .filter((e) => e.kind === "DEPENDS_ON")
    .filter((e) => {
      const prerequisite = nodeByRefKey.get(e.from);
      const dependent = nodeByRefKey.get(e.to);
      return (
        dependent?.kind === "TASK" &&
        statusOf(dependent) === "done" &&
        prerequisite?.kind === "TASK" &&
        statusOf(prerequisite) !== "done"
      );
    });

  if (premature.length > 0) {
    findings.push({
      domain: "CROSS_DOMAIN",
      severity: "warning",
      message: `${premature.length} task${premature.length === 1 ? " is" : "s are"} marked done while a prerequisite is not.`,
      nodes: premature
        .map((e) => nodeByRefKey.get(e.to))
        .filter((n): n is GraphNode => n !== undefined)
        .map(linkOf),
    });
  }

  return findings;
}

/**
 * 5. Flagged and never revised.
 *
 * The staleness marker records the content hash at the moment it was set. If
 * that hash still matches, nobody has touched the artifact since — which is
 * precisely the failure the product exists to prevent: a change whose
 * consequences were surfaced and then ignored.
 */
export function checkStaleDownstream(input: GraphCheckInput): FitFinding[] {
  const unrevised = input.graph.nodes.filter(
    (n) =>
      n.staleAt != null &&
      n.reviewedAt == null &&
      n.contentHash != null &&
      n.contentHash === n.staleContentHash,
  );
  if (unrevised.length === 0) return [];

  const shown = unrevised.slice(0, 5).map((n) => n.label);
  return [
    {
      domain: "CROSS_DOMAIN",
      severity: "warning",
      message: `${unrevised.length} artifact${unrevised.length === 1 ? " was" : "s were"} flagged by an earlier change and never revised: ${shown.join(", ")}${unrevised.length > shown.length ? `, +${unrevised.length - shown.length} more` : ""}.`,
      hint: "Revise them, or mark them reviewed if the change does not apply.",
      nodes: unrevised.map(linkOf),
    },
  ];
}

/**
 * 6. A check pointing at nothing.
 *
 * Nearly free once targetPath resolution exists, and it catches real typos —
 * a check aimed at `parts/enclosure.kcl` after the file was renamed is a check
 * that silently verifies nothing.
 */
export function checkOrphanTargets(input: GraphCheckInput): FitFinding[] {
  const resolved = new Set(
    input.graph.edges.filter((e) => e.rule === "check-targetpath").map((e) => e.to),
  );
  const nodeByRefKey = new Map(input.graph.nodes.map((n) => [n.refKey, n]));

  const orphans = input.validationChecks.filter(
    (c) => c.id && c.targetPath?.trim() && !resolved.has(`check:${c.id}`),
  );
  if (orphans.length === 0) return [];

  return [
    {
      domain: "CROSS_DOMAIN",
      severity: "warning",
      message: `${orphans.length} validation check${orphans.length === 1 ? "" : "s"} target a path that nothing in the project matches: ${orphans.map((c) => c.targetPath).join(", ")}.`,
      hint: "Fix the target path — as written, the check verifies nothing.",
      nodes: orphans
        .map((c) => nodeByRefKey.get(`check:${c.id}`))
        .filter((n): n is GraphNode => n !== undefined)
        .map(linkOf),
    },
  ];
}

/**
 * 7. A part with no long-term future and nothing lined up to replace it.
 *
 * Lifecycle status comes from `@foundry/sourcing`'s deterministic offline
 * adapter, re-derived here from the same part key (`partNumber ?? id`) rather
 * than threaded in as live quote data — that keeps this check pure and
 * synchronous like every other one in this file, with no async pricing call
 * creeping into `evaluateFit`. Only EOL-with-no-substitute is flagged: NRND
 * alone is not yet actionable, matching this file's existing bias toward not
 * nagging over something nobody can do anything about today.
 */
export function checkLifecycleRisk(input: GraphCheckInput): FitFinding[] {
  const nodeByRefKey = new Map(input.graph.nodes.map((n) => [n.refKey, n]));
  const link = (id: string | undefined) => {
    const n = id ? nodeByRefKey.get(`component:${id}`) : undefined;
    return n ? linkOf(n) : null;
  };

  // Electronics only — the only parts the sourcing panel estimates a lifecycle for.
  const atRisk = input.components.filter((c) => {
    if (!c.id || c.discipline !== "ELECTRONICS") return false;
    const partKey = partKeyOf({ id: c.id, mpn: c.partNumber });
    return lifecycleStatusOf(partKey) === "EOL" && !hasSubstituteOf(partKey);
  });
  if (atRisk.length === 0) return [];

  return [
    {
      domain: "CROSS_DOMAIN",
      severity: "warning",
      message: `${atRisk.length} component${atRisk.length === 1 ? " is" : "s are"} end-of-life with no substitute on file: ${atRisk.map((c) => c.name).join(", ")}.`,
      hint: "Line up a second source before this becomes a build blocker. (Lifecycle data is a simulated estimate until a distributor is connected.)",
      nodes: atRisk
        .map((c) => link(c.id))
        .filter((n): n is { refKey: string; label: string } => n !== null),
    },
  ];
}

/** Every graph-backed check. Called from evaluateFit when a graph exists. */
export function checkGraph(input: FitInput, graph: GraphSnapshot): FitFinding[] {
  const scoped: GraphCheckInput = { ...input, graph };
  return [
    ...checkRequirementCoverage(scoped),
    ...checkComponentSoftware(scoped),
    ...checkPowerBudget(scoped),
    ...checkTaskDependencies(scoped),
    ...checkStaleDownstream(scoped),
    ...checkOrphanTargets(scoped),
    ...checkLifecycleRisk(scoped),
  ];
}
