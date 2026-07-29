import "server-only";

import { prisma, type Prisma } from "@foundry/db";
import { validateUIMessages, type UIMessage } from "ai";
import { persistFailedRunFromEvents } from "./persist";
import { publishRunFinished } from "./publish";

/** PENDING with no worker pickup — usually Redis/worker down. */
const PENDING_STALE_MS = 45_000;
/**
 * RUNNING without finishing — worker crashed mid-stream. A single Zoo
 * text_to_cad / multi-part assembly can run a long time with no stream chunks,
 * so this has to sit above Zoo's worst-case wall clock or runs die mid-flight.
 */
const RUNNING_STALE_MS = 40 * 60_000;

type ChatRunClient = Pick<Prisma.TransactionClient, "chatRun">;

type ExpiredRun = {
  id: string;
  channelId: string;
  projectId: string;
  branchId: string;
  error: string;
  inputMessages: unknown;
};

async function expireStaleRuns(
  db: ChatRunClient,
  scope: Prisma.ChatRunWhereInput,
): Promise<ExpiredRun[]> {
  const now = Date.now();
  const pendingWhere: Prisma.ChatRunWhereInput = {
    ...scope,
    status: "PENDING",
    createdAt: { lt: new Date(now - PENDING_STALE_MS) },
  };
  const runningWhere: Prisma.ChatRunWhereInput = {
    ...scope,
    status: "RUNNING",
    // Measure from pickup, not enqueue, so queue wait doesn't count.
    OR: [
      { startedAt: { lt: new Date(now - RUNNING_STALE_MS) } },
      { startedAt: null, createdAt: { lt: new Date(now - RUNNING_STALE_MS) } },
    ],
  };

  const select = {
    id: true,
    channelId: true,
    projectId: true,
    branchId: true,
    inputMessages: true,
  } as const;

  const [pendingRows, runningRows] = await Promise.all([
    db.chatRun.findMany({ where: pendingWhere, select }),
    db.chatRun.findMany({ where: runningWhere, select }),
  ]);

  const expired: ExpiredRun[] = [
    ...pendingRows.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      projectId: r.projectId,
      branchId: r.branchId,
      inputMessages: r.inputMessages,
      error: "Timed out waiting for worker (check Redis / chat worker)",
    })),
    ...runningRows.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      projectId: r.projectId,
      branchId: r.branchId,
      inputMessages: r.inputMessages,
      error: "Timed out (stale run)",
    })),
  ];
  if (expired.length === 0) return [];

  await Promise.all([
    pendingRows.length
      ? db.chatRun.updateMany({
          where: { id: { in: pendingRows.map((r) => r.id) } },
          data: {
            status: "ERROR",
            error: "Timed out waiting for worker (check Redis / chat worker)",
            finishedAt: new Date(),
          },
        })
      : Promise.resolve(),
    runningRows.length
      ? db.chatRun.updateMany({
          where: { id: { in: runningRows.map((r) => r.id) } },
          data: {
            status: "ERROR",
            error: "Timed out (stale run)",
            finishedAt: new Date(),
          },
        })
      : Promise.resolve(),
  ]);

  return expired;
}

async function persistAndBroadcastExpired(expired: ExpiredRun[]): Promise<void> {
  await Promise.all(
    expired.map(async (run) => {
      try {
        let inputMessages: UIMessage[] = [];
        try {
          inputMessages = await validateUIMessages({
            messages: run.inputMessages as unknown[],
          });
        } catch {
          inputMessages = [];
        }
        await persistFailedRunFromEvents({
          runId: run.id,
          scope: {
            projectId: run.projectId,
            branchId: run.branchId,
            channelId: run.channelId,
          },
          inputMessages,
          error: run.error,
        });
      } catch (err) {
        console.error(`[chat-run] failed to persist stale run ${run.id}`, err);
      }
      await publishRunFinished(run.id, run.channelId, "error", run.error);
    }),
  );
}

/**
 * Mark stuck chat runs as ERROR so the UI isn't permanently "busy"
 * and new messages can be sent. Persists whatever streamed so far (with a
 * failure stamp) and broadcasts run-finished with the timeout reason.
 */
export async function expireStaleChatRuns(channelId: string): Promise<number> {
  const expired = await expireStaleRuns(prisma, { channelId });
  await persistAndBroadcastExpired(expired);
  return expired.length;
}

/** Clear stale runs before evaluating the branch-wide AI edit lock. */
export async function expireStaleProjectRuns(
  projectId: string,
  branchId: string,
  db: ChatRunClient = prisma,
): Promise<number> {
  const expired = await expireStaleRuns(db, { projectId, branchId });
  // Only broadcast/persist when using the default prisma client (not inside a
  // txn that may roll back the ERROR status).
  if (db === prisma) {
    await persistAndBroadcastExpired(expired);
  }
  return expired.length;
}
