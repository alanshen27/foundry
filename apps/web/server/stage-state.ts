import { prisma } from "@foundry/db";
import {
  canTransitionStage,
  STAGES,
  VERIFICATION_RERUN_STATUSES,
  verificationResetForEngineeringChange,
  type Stage,
  type StageStatus,
} from "@foundry/domain";
import { recordAudit } from "./audit";
import { createLogger } from "@foundry/observability";

const log = createLogger("graph");

/**
 * Transition a stage's status if the move is legal, recording a
 * StageStatusChanged audit event. No-ops (and returns false) when the
 * transition is not permitted by the stage lifecycle graph.
 */
export async function setStageStatus(params: {
  workspaceId: string;
  projectId: string;
  branchId: string;
  stage: Stage;
  to: StageStatus;
  actorId: string;
}): Promise<boolean> {
  const state = await prisma.stageState.findUnique({
    where: {
      projectId_branchId_stage: {
        projectId: params.projectId,
        branchId: params.branchId,
        stage: params.stage,
      },
    },
  });
  if (!state) return false;
  const from = state.status as StageStatus;
  if (from === params.to) return true;
  if (!canTransitionStage(from, params.to)) return false;

  await prisma.stageState.update({
    where: { id: state.id },
    data: {
      status: params.to,
      ...(params.to !== "APPROVED" ? { approvedById: null, approvedAt: null } : {}),
    },
  });
  await recordAudit({
    type: "StageStatusChanged",
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    branchId: params.branchId,
    actorId: params.actorId,
    payload: { stage: params.stage, from, to: params.to },
  });
  return true;
}

/** An approved snapshot must be reviewed again after its own content changes. */
export async function invalidateStageApproval(params: {
  workspaceId: string;
  projectId: string;
  branchId: string;
  stage: Stage;
  actorId: string;
}): Promise<boolean> {
  const state = await prisma.stageState.findUnique({
    where: {
      projectId_branchId_stage: {
        projectId: params.projectId,
        branchId: params.branchId,
        stage: params.stage,
      },
    },
  });
  if (state?.status !== "APPROVED") return false;
  return setStageStatus({ ...params, to: "STALE" });
}

/**
 * Ensure a stage that is being actively edited reflects work-in-progress.
 * Bumps NOT_STARTED -> DRAFT so the overview and left rail stop showing an
 * untouched stage once content exists.
 */
export async function ensureStageStarted(params: {
  workspaceId: string;
  projectId: string;
  branchId: string;
  stage: Stage;
  actorId: string;
}): Promise<void> {
  const state = await prisma.stageState.findUnique({
    where: {
      projectId_branchId_stage: {
        projectId: params.projectId,
        branchId: params.branchId,
        stage: params.stage,
      },
    },
  });
  if (state && state.status === "NOT_STARTED") {
    await setStageStatus({ ...params, to: "DRAFT" });
  }
}

/**
 * Divergence handling: when the content of `changedStage` is edited, any
 * downstream stage that was already APPROVED (or waiting on review) no
 * longer reflects reality and is marked STALE for re-review (PRD 5.5).
 * Returns the list of stages that were flagged.
 */
export async function markDownstreamStale(params: {
  workspaceId: string;
  projectId: string;
  branchId: string;
  changedStage: Stage;
  actorId: string;
}): Promise<Stage[]> {
  if (params.changedStage === "ENGINEER") {
    const reset = await prisma.validationCheck.updateMany({
      where: {
        projectId: params.projectId,
        branchId: params.branchId,
        OR: [{ status: { in: [...VERIFICATION_RERUN_STATUSES] } }, { waived: true }],
      },
      data: verificationResetForEngineeringChange(),
    });
    if (reset.count > 0) {
      await recordAudit({
        type: "ValidationCheckUpdated",
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        branchId: params.branchId,
        actorId: params.actorId,
        payload: {
          action: "source_changed",
          changedStage: "ENGINEER",
          resetCount: reset.count,
          status: "PENDING",
        },
      });
    }
  }
  const downstream = STAGES.slice(STAGES.indexOf(params.changedStage) + 1);
  if (downstream.length === 0) return [];

  const states = await prisma.stageState.findMany({
    where: {
      projectId: params.projectId,
      branchId: params.branchId,
      stage: { in: [...downstream] },
      status: { in: ["APPROVED", "NEEDS_REVIEW"] },
    },
  });

  const flagged: Stage[] = [];
  for (const state of states) {
    const to: StageStatus = state.status === "APPROVED" ? "STALE" : "DRAFT";
    const ok = await setStageStatus({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      branchId: params.branchId,
      stage: state.stage as Stage,
      to,
      actorId: params.actorId,
    });
    if (ok) flagged.push(state.stage as Stage);
  }
  return flagged;
}

/**
 * The single hook every edit to project content goes through.
 *
 * It bundles the three things that must happen after any mutation — the stage
 * starts, downstream stages that were approved go stale, and the product graph
 * catches up — so that adding a thirty-first AI tool cannot accidentally ship
 * without graph maintenance. There is deliberately no `update_graph` tool for
 * the model to call: a maintenance step the model has to remember is a
 * maintenance step that gets skipped, and then the impact panel is wrong in
 * front of whoever is watching.
 *
 * Note that stage staleness and node staleness are different things and both
 * are kept. `markDownstreamStale` says "the Verify stage no longer reflects
 * reality"; the graph says "this specific requirement needs another look".
 */
export async function touchProject(params: {
  workspaceId: string;
  projectId: string;
  branchId: string;
  stage: Stage;
  actorId: string;
  actorType?: "USER" | "AGENT" | "SYSTEM";
  /**
   * Skips the graph resync. The copilot sets this on every tool and flushes
   * once when the turn ends, because a single chat run can touch a dozen
   * artifacts and re-deriving after each one would add seconds to the reply
   * for a result nobody sees until the end.
   */
  deferGraph?: boolean;
}): Promise<void> {
  await ensureStageStarted(params);
  await markDownstreamStale({ ...params, changedStage: params.stage });
  if (params.deferGraph) return;
  await syncGraphQuietly(params);
}

/**
 * Resyncs the graph, swallowing failures.
 *
 * The graph is an index over content that has already been saved. If deriving
 * it throws — a malformed CAD import, a schematic the netlist cannot walk —
 * the user's edit still succeeded, and failing their save to report a stale
 * index would be the wrong trade. The error is logged and the next sync picks
 * it up.
 */
async function syncGraphQuietly(params: {
  workspaceId: string;
  projectId: string;
  branchId: string;
  actorId: string;
  actorType?: "USER" | "AGENT" | "SYSTEM";
}): Promise<void> {
  try {
    const { syncProductGraph } = await import("./graph/sync");
    await syncProductGraph(params);
  } catch (error) {
    // The user's save already succeeded, so this does not fail the request —
    // but a graph that silently stops syncing is a bug worth being told about.
    log.error("graph sync failed", {
      projectId: params.projectId,
      branchId: params.branchId,
      err: error,
    });
  }
}
