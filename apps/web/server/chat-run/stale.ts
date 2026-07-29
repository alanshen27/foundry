import "server-only";

import { prisma, type Prisma } from "@foundry/db";
import { publishRunFinished } from "./publish";

/** PENDING with no worker pickup — usually Redis/worker down. */
const PENDING_STALE_MS = 45_000;
/**
 * RUNNING without finishing — worker crashed mid-stream. A single Zoo
 * text_to_cad / assembly job polls for up to ~10 minutes and emits no chunks
 * while it waits, so this has to sit above that or long CAD runs get killed
 * mid-flight.
 */
const RUNNING_STALE_MS = 12 * 60_000;

type ChatRunClient = Pick<Prisma.TransactionClient, "chatRun">;

type ExpiredRun = { id: string; channelId: string; error: string };

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

  const [pendingRows, runningRows] = await Promise.all([
    db.chatRun.findMany({
      where: pendingWhere,
      select: { id: true, channelId: true },
    }),
    db.chatRun.findMany({
      where: runningWhere,
      select: { id: true, channelId: true },
    }),
  ]);

  const expired: ExpiredRun[] = [
    ...pendingRows.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      error: "Timed out waiting for worker (check Redis / chat worker)",
    })),
    ...runningRows.map((r) => ({
      id: r.id,
      channelId: r.channelId,
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

/**
 * Mark stuck chat runs as ERROR so the UI isn't permanently "busy"
 * and new messages can be sent. Broadcasts run-finished with the timeout
 * reason so the client can stamp a real failure note.
 */
export async function expireStaleChatRuns(channelId: string): Promise<number> {
  const expired = await expireStaleRuns(prisma, { channelId });
  await Promise.all(
    expired.map((run) => publishRunFinished(run.id, run.channelId, "error", run.error)),
  );
  return expired.length;
}

/** Clear stale runs before evaluating the branch-wide AI edit lock. */
export async function expireStaleProjectRuns(
  projectId: string,
  branchId: string,
  db: ChatRunClient = prisma,
): Promise<number> {
  const expired = await expireStaleRuns(db, { projectId, branchId });
  // Only broadcast when using the default prisma client (not inside a txn
  // that may not have a publisher wired the same way).
  if (db === prisma) {
    await Promise.all(
      expired.map((run) => publishRunFinished(run.id, run.channelId, "error", run.error)),
    );
  }
  return expired.length;
}
