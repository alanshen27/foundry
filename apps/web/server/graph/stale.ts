/**
 * Recording an impact analysis onto the graph.
 *
 * `impactFrom` answers the question; this is what makes the answer stick. The
 * distinction matters: an impact panel a user closes and forgets is a report,
 * whereas a flag that persists on the artifact — and shows up as an amber dot
 * on the requirement row three tabs away — is a piece of process. The product's
 * whole claim is that consequences do not get lost, and a flag that outlives
 * the panel is how that claim is cashed.
 *
 * `staleContentHash` is the important field. It records what the artifact
 * looked like at the moment it was flagged, so later we can distinguish
 * "flagged and revised" from "flagged and ignored" without asking anyone.
 */

import { prisma } from "@foundry/db";
import { impactFrom, type ImpactNode } from "@/lib/graph/impact";
import { REVIEWABLE_NODE_KINDS } from "@/lib/graph/types";
import { recordAudit } from "@/server/audit";
import { loadGraphSnapshot } from "./sync";

export type MarkImpactedResult = {
  root: string;
  marked: number;
  impacted: ImpactNode[];
};

/**
 * Flags everything downstream of a change as needing another look.
 *
 * Only marks nodes that are not already flagged, so re-running after a second
 * change does not overwrite the first change's reason with a newer one — the
 * earliest unresolved cause is the more useful thing to show.
 */
export async function markImpacted(params: {
  projectId: string;
  branchId: string;
  workspaceId: string;
  actorId: string;
  actorType?: "USER" | "AGENT" | "SYSTEM";
  refKey: string;
  maxDepth?: number;
  minConfidence?: number;
}): Promise<MarkImpactedResult> {
  const { projectId, branchId, workspaceId, actorId, refKey } = params;

  const graph = await loadGraphSnapshot(projectId, branchId);
  const impacted = impactFrom(graph, refKey, {
    maxDepth: params.maxDepth,
    minConfidence: params.minConfidence,
  });

  const root = graph.nodes.find((n) => n.refKey === refKey);
  const byRefKey = new Map(graph.nodes.map((n) => [n.refKey, n]));
  const now = new Date();

  let marked = 0;
  for (const node of impacted) {
    // Everything reachable is reported to the user; only work a person would
    // actually open gets flagged. See REVIEWABLE_NODE_KINDS.
    if (!REVIEWABLE_NODE_KINDS.has(node.kind)) continue;
    const current = byRefKey.get(node.refKey);
    if (!current || current.staleAt != null) continue;
    await prisma.productNode.update({
      where: { id: node.nodeId },
      data: {
        staleAt: now,
        staleReason: node.reason,
        staleFromId: root?.id ?? null,
        staleDepth: node.depth,
        staleConfidence: node.confidence,
        // The artifact as it stands right now. If this still matches at the
        // next sync, nobody has touched it.
        staleContentHash: current.contentHash,
        reviewedAt: null,
        reviewedById: null,
      },
    });
    marked++;
  }

  await recordAudit({
    type: "ImpactAnalysisRun",
    workspaceId,
    projectId,
    branchId,
    actorId,
    actorType: params.actorType ?? "USER",
    payload: { refKey, impacted: impacted.length, marked },
  });

  return { root: refKey, marked, impacted };
}

/**
 * Accepts an impacted artifact as it stands.
 *
 * Kept distinct from revising it: "I looked and this change does not apply" is
 * a real answer, and forcing a cosmetic edit to clear the flag would make the
 * flag worse than useless.
 */
export async function markNodeReviewed(params: {
  nodeId: string;
  workspaceId: string;
  projectId: string;
  branchId: string;
  actorId: string;
}): Promise<void> {
  await prisma.productNode.update({
    where: { id: params.nodeId },
    data: {
      reviewedAt: new Date(),
      reviewedById: params.actorId,
      staleAt: null,
      staleReason: null,
      staleFromId: null,
      staleDepth: null,
      staleConfidence: null,
      staleContentHash: null,
    },
  });

  await recordAudit({
    type: "ProductNodeReviewed",
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    branchId: params.branchId,
    actorId: params.actorId,
    payload: { nodeId: params.nodeId },
  });
}
