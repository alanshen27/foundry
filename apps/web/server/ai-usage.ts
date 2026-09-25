/**
 * What the copilot costs, per run and per workspace.
 *
 * Until this existed nothing in the product counted tokens: a run stored its
 * status and its messages, and the only way to learn what a week of use had
 * cost was the provider's invoice. Every run now records its usage — summed
 * per model step, so a run that dies at step ten still accounts for ten steps
 * — and a workspace can be given a rolling daily budget.
 *
 * Tokens rather than dollars on purpose. Prices change and vary by account;
 * a dollar figure computed here would be a guess presented as a fact. Tokens
 * are what the provider actually reports.
 */

import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import { createLogger } from "@foundry/observability";

const log = createLogger("ai-usage");

export type RunUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  stepCount: number;
};

/** The subset of the AI SDK's LanguageModelUsage this reads. */
export type StepUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number | undefined };
  outputTokenDetails?: { reasoningTokens?: number | undefined };
};

export const emptyUsage = (): RunUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  stepCount: 0,
});

/**
 * Adds one step's usage to a running total.
 *
 * Providers omit fields rather than sending zero, so a missing figure counts
 * as nothing. A missing total is rebuilt from input + output, because some
 * providers report the parts but not the sum.
 */
export function addStepUsage(total: RunUsage, step: StepUsage | undefined): RunUsage {
  if (!step) return { ...total, stepCount: total.stepCount + 1 };
  const input = step.inputTokens ?? 0;
  const output = step.outputTokens ?? 0;
  return {
    inputTokens: total.inputTokens + input,
    cachedInputTokens: total.cachedInputTokens + (step.inputTokenDetails?.cacheReadTokens ?? 0),
    outputTokens: total.outputTokens + output,
    reasoningTokens: total.reasoningTokens + (step.outputTokenDetails?.reasoningTokens ?? 0),
    totalTokens: total.totalTokens + (step.totalTokens ?? input + output),
    stepCount: total.stepCount + 1,
  };
}

/** Writes a run's usage. Best effort: metering must never fail a user's turn. */
export async function recordRunUsage(runId: string, model: string, usage: RunUsage) {
  if (usage.stepCount === 0) return;
  try {
    await prisma.chatRun.update({
      where: { id: runId },
      data: { model, ...usage },
    });
  } catch (err) {
    log.error("failed to record usage", { runId, err });
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type WorkspaceUsage = {
  /** Tokens spent in the rolling window. */
  totalTokens: number;
  runs: number;
  /** Null when no budget is configured. */
  budget: number | null;
  windowHours: number;
};

/** Copilot tokens a workspace has spent in the last 24 hours. */
export async function workspaceUsage(
  workspaceId: string,
  now: Date = new Date(),
): Promise<WorkspaceUsage> {
  const since = new Date(now.getTime() - DAY_MS);
  const aggregate = await prisma.chatRun.aggregate({
    where: { project: { workspaceId }, createdAt: { gte: since } },
    _sum: { totalTokens: true },
    _count: { _all: true },
  });
  return {
    totalTokens: aggregate._sum.totalTokens ?? 0,
    runs: aggregate._count._all,
    budget: getServerEnv().AI_WORKSPACE_DAILY_TOKEN_BUDGET ?? null,
    windowHours: 24,
  };
}

export type BudgetDecision =
  | { allowed: true; usage: WorkspaceUsage }
  | { allowed: false; usage: WorkspaceUsage; message: string };

/**
 * Whether a workspace may start another copilot run.
 *
 * Checked before a run starts, not during it: stopping a run halfway through
 * a CAD generation would leave the project half-edited, which costs the user
 * more than the few extra tokens it would save.
 */
export async function checkWorkspaceBudget(workspaceId: string): Promise<BudgetDecision> {
  const usage = await workspaceUsage(workspaceId);
  if (usage.budget === null || usage.totalTokens < usage.budget) {
    return { allowed: true, usage };
  }
  return {
    allowed: false,
    usage,
    message: `This workspace has used its copilot budget for the last 24 hours (${usage.totalTokens.toLocaleString("en-US")} of ${usage.budget.toLocaleString("en-US")} tokens). It frees up as older runs age out of the window.`,
  };
}
