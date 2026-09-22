/**
 * Runs the cross-stage fit check for a project.
 *
 * Reading the project lives in server/graph/gather.ts and the evaluation is
 * pure, so the copilot's `check_integration` tool, the Verify panel and the
 * graph sync can never disagree about what was checked.
 */

import { prisma } from "@foundry/db";
import { evaluateFit, type FitReport } from "@/lib/integration/fit-check";
import { gatherProjectState } from "./graph/gather";
import { loadGraphSnapshot } from "./graph/sync";

export async function runFitCheck(projectId: string, branchId: string): Promise<FitReport> {
  const [state, graph] = await Promise.all([
    gatherProjectState(projectId, branchId),
    loadGraphSnapshot(projectId, branchId),
  ]);

  // A project whose graph has never been built gets the original check and
  // nothing else — reporting graph findings against an empty graph would
  // claim every requirement is unverified.
  return evaluateFit({ ...state, graph: graph.nodes.length > 0 ? graph : undefined });
}

/** Whether a branch has a graph at all, for the "Build graph" affordance. */
export async function hasProductGraph(projectId: string, branchId: string): Promise<boolean> {
  const count = await prisma.productNode.count({ where: { projectId, branchId } });
  return count > 0;
}
