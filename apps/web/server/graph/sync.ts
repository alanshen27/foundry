/**
 * Reconciles the stored graph with what the project currently implies.
 *
 * The rule that makes this safe to run at any time, as often as we like:
 * ONLY `origin: DERIVED` rows are ever deleted. Edges a person drew and nodes
 * the copilot created survive every rebuild, because they encode judgement
 * that cannot be re-derived — losing one to a routine resync would be losing
 * work. That single constraint is what lets "Rebuild graph" be a button
 * anybody can press without thinking about it.
 *
 * The other subtlety is staleness. A node flagged by an earlier change keeps
 * that flag across syncs, because the flag is a claim about human attention,
 * not about data. It clears only when the artifact's content hash has actually
 * moved — i.e. somebody revised it — or when a person explicitly marks it
 * reviewed.
 */

import { prisma, type Prisma } from "@foundry/db";
import { deriveGraph } from "@/lib/graph/derive";
import { evaluateFit, type FitReport } from "@/lib/integration/fit-check";
import type { GraphSnapshot } from "@/lib/graph/types";
import { recordAudit } from "@/server/audit";
import { gatherProjectState } from "./gather";

export type SyncResult = {
  nodeCount: number;
  edgeCount: number;
  added: number;
  removed: number;
  /** Nodes whose staleness cleared because the artifact was actually revised. */
  refreshed: number;
};

/**
 * Rebuilds the derived half of the graph from current project state.
 *
 * `report` lets a caller that has already run the fit check this turn hand its
 * result over instead of paying for a second firmware simulation — the copilot
 * does exactly that after `check_integration`.
 */
export async function syncProductGraph(params: {
  projectId: string;
  branchId: string;
  workspaceId: string;
  actorId: string;
  actorType?: "USER" | "AGENT" | "SYSTEM";
  report?: FitReport;
}): Promise<SyncResult> {
  const { projectId, branchId, workspaceId, actorId } = params;

  const state = await gatherProjectState(projectId, branchId);
  const report = params.report ?? evaluateFit(state);
  const derived = deriveGraph({ ...state, simulation: report.simulation });

  const existing = await prisma.productNode.findMany({
    where: { projectId, branchId },
    select: {
      id: true,
      refKey: true,
      origin: true,
      contentHash: true,
      staleAt: true,
      staleContentHash: true,
    },
  });
  const existingByRefKey = new Map(existing.map((n) => [n.refKey, n]));
  const derivedKeys = new Set(derived.nodes.map((n) => n.refKey));

  let added = 0;
  let refreshed = 0;

  const idByRefKey = new Map<string, string>(existing.map((n) => [n.refKey, n.id]));

  await prisma.$transaction(async (tx) => {
    for (const node of derived.nodes) {
      const prior = existingByRefKey.get(node.refKey);

      // The artifact changed since it was flagged, so somebody has looked at
      // it. Dropping the flag here is what stops the checks panel nagging
      // about work that is already done.
      const revised =
        prior?.staleAt != null &&
        prior.staleContentHash != null &&
        node.contentHash != null &&
        prior.staleContentHash !== node.contentHash;
      if (revised) refreshed++;

      const upserted = await tx.productNode.upsert({
        where: { projectId_branchId_refKey: { projectId, branchId, refKey: node.refKey } },
        create: {
          projectId,
          branchId,
          kind: node.kind,
          refKey: node.refKey,
          refId: node.refId ?? null,
          label: node.label,
          data: (node.data ?? {}) as Prisma.InputJsonValue,
          origin: node.origin,
          originDetail: node.originDetail ?? null,
          contentHash: node.contentHash ?? null,
        },
        // Deliberately does not touch origin, staleAt or reviewedAt: a node
        // that a person promoted or flagged keeps that state.
        update: {
          kind: node.kind,
          refId: node.refId ?? null,
          label: node.label,
          contentHash: node.contentHash ?? null,
          ...(revised
            ? {
                staleAt: null,
                staleReason: null,
                staleFromId: null,
                staleDepth: null,
                staleConfidence: null,
                staleContentHash: null,
              }
            : {}),
        },
        select: { id: true },
      });
      if (!prior) added++;
      idByRefKey.set(node.refKey, upserted.id);
    }

    // Derived nodes the project no longer implies. Their edges cascade.
    const removable = existing.filter((n) => n.origin === "DERIVED" && !derivedKeys.has(n.refKey));
    if (removable.length > 0) {
      await tx.productNode.deleteMany({ where: { id: { in: removable.map((n) => n.id) } } });
    }

    // Edges. Authored ones are never in this set and are never deleted below.
    const keptEdgeIds: string[] = [];
    for (const edge of derived.edges) {
      const fromId = idByRefKey.get(edge.from);
      const toId = idByRefKey.get(edge.to);
      // An edge whose endpoint did not survive derivation has nothing to
      // attach to. Skipping is correct: the next sync re-creates it if the
      // endpoint comes back.
      if (!fromId || !toId) continue;
      const upserted = await tx.productEdge.upsert({
        where: { fromId_toId_kind: { fromId, toId, kind: edge.kind } },
        create: {
          projectId,
          branchId,
          fromId,
          toId,
          kind: edge.kind,
          origin: "DERIVED",
          rule: edge.rule ?? null,
          confidence: edge.confidence,
          evidence: edge.evidence ?? null,
        },
        update: {
          rule: edge.rule ?? null,
          confidence: edge.confidence,
          evidence: edge.evidence ?? null,
        },
        select: { id: true },
      });
      keptEdgeIds.push(upserted.id);
    }

    await tx.productEdge.deleteMany({
      where: { projectId, branchId, origin: "DERIVED", id: { notIn: keptEdgeIds } },
    });
  });

  const removed = existing.filter(
    (n) => n.origin === "DERIVED" && !derivedKeys.has(n.refKey),
  ).length;

  await recordAudit({
    type: "ProductGraphSynced",
    workspaceId,
    projectId,
    branchId,
    actorId,
    actorType: params.actorType ?? "USER",
    payload: {
      nodeCount: derived.nodes.length,
      edgeCount: derived.edges.length,
      added,
      removed,
      refreshed,
    },
  });

  return {
    nodeCount: derived.nodes.length,
    edgeCount: derived.edges.length,
    added,
    removed,
    refreshed,
  };
}

/** Loads the whole graph for a branch, shaped for the pure modules. */
export async function loadGraphSnapshot(
  projectId: string,
  branchId: string,
): Promise<GraphSnapshot> {
  const [nodes, edges] = await Promise.all([
    prisma.productNode.findMany({ where: { projectId, branchId } }),
    prisma.productEdge.findMany({
      where: { projectId, branchId },
      include: {
        from: { select: { refKey: true } },
        to: { select: { refKey: true } },
      },
    }),
  ]);

  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      refKey: n.refKey,
      refId: n.refId,
      label: n.label,
      data: (n.data ?? {}) as Record<string, unknown>,
      origin: n.origin,
      originDetail: n.originDetail,
      contentHash: n.contentHash,
      staleAt: n.staleAt,
      staleReason: n.staleReason,
      staleFromId: n.staleFromId,
      staleDepth: n.staleDepth,
      staleConfidence: n.staleConfidence,
      staleContentHash: n.staleContentHash,
      reviewedAt: n.reviewedAt,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      kind: e.kind,
      from: e.from.refKey,
      to: e.to.refKey,
      origin: e.origin,
      rule: e.rule,
      confidence: e.confidence,
      evidence: e.evidence,
    })),
  };
}
