import { prisma } from "@foundry/db";
import { canTransitionStage, STAGES, type Stage, type StageStatus } from "@foundry/domain";
import { recordAudit } from "./audit";

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
    data: { status: params.to },
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
