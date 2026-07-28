import "server-only";

import { prisma, type Prisma } from "@foundry/db";
import { ACTIVE_AI_RUN_STATUSES } from "@/lib/ai-edit-policy";
import { expireStaleProjectRuns } from "./chat-run/stale";

const activeRunSelect = {
  id: true,
  actorId: true,
  channelId: true,
  status: true,
  createdAt: true,
  startedAt: true,
} satisfies Prisma.ChatRunSelect;

export type ActiveAiEditLock = Prisma.ChatRunGetPayload<{
  select: typeof activeRunSelect;
}>;

async function acquireBranchEditMutex(
  tx: Prisma.TransactionClient,
  projectId: string,
  branchId: string,
): Promise<void> {
  const branchKey = `${projectId}:${branchId}`;
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('foundry-ai-edit'),
      hashtext(${branchKey})
    )
  `;
}

async function findActiveAiEditLock(
  db: Pick<Prisma.TransactionClient, "chatRun">,
  projectId: string,
  branchId: string,
): Promise<ActiveAiEditLock | null> {
  return db.chatRun.findFirst({
    where: {
      projectId,
      branchId,
      status: { in: [...ACTIVE_AI_RUN_STATUSES] },
    },
    orderBy: { createdAt: "asc" },
    select: activeRunSelect,
  });
}

/**
 * The active copilot run is the branch-wide edit lease. It intentionally
 * covers the whole run: a model can decide to mutate after several read-only
 * tool calls, so waiting until the first write leaves a race with human edits.
 */
export async function getActiveAiEditLock(
  projectId: string,
  branchId: string,
): Promise<ActiveAiEditLock | null> {
  await expireStaleProjectRuns(projectId, branchId);
  return findActiveAiEditLock(prisma, projectId, branchId);
}

export class AiEditLockConflict extends Error {
  constructor(readonly lock: ActiveAiEditLock) {
    super("Workspace locked while an AI agent is editing.");
    this.name = "AiEditLockConflict";
  }
}

/**
 * Serialize a human CAD save with AI lock acquisition, then run it only when
 * no AI owns the branch. Sharing the advisory mutex closes the small
 * check-then-save race that a read-only lock query would leave behind.
 */
export function withAiEditLockGuard<T>(
  projectId: string,
  branchId: string,
  save: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await acquireBranchEditMutex(tx, projectId, branchId);
    await expireStaleProjectRuns(projectId, branchId, tx);
    const active = await findActiveAiEditLock(tx, projectId, branchId);
    if (active) throw new AiEditLockConflict(active);
    return save(tx);
  });
}

type CreateRunInput = {
  projectId: string;
  branchId: string;
  channelId: string;
  actorId: string;
  inputMessages: Prisma.InputJsonValue;
};

export type ExclusiveRunResult =
  { created: true; run: { id: string } } | { created: false; active: ActiveAiEditLock };

/**
 * Atomically acquire the branch edit lease and create its run.
 *
 * The transaction-level advisory lock serializes requests from different chat
 * channels and app instances. A query-then-create without it lets two agents
 * both observe an empty branch and start together.
 */
export function createExclusiveAiRun(input: CreateRunInput): Promise<ExclusiveRunResult> {
  return prisma.$transaction(async (tx) => {
    await acquireBranchEditMutex(tx, input.projectId, input.branchId);
    await expireStaleProjectRuns(input.projectId, input.branchId, tx);
    const active = await findActiveAiEditLock(tx, input.projectId, input.branchId);
    if (active) return { created: false, active };

    const run = await tx.chatRun.create({
      data: input,
      select: { id: true },
    });
    return { created: true, run };
  });
}
