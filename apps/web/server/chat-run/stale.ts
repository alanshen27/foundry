import "server-only";

import { prisma, type Prisma } from "@foundry/db";
import { type UIMessage } from "ai";
import { persistFailedRunFromEvents } from "./persist";
import { validateResumableUIMessages } from "./sanitize-messages";
import { publishRunFinished } from "./publish";
import { createLogger } from "@foundry/observability";

const log = createLogger("chat-run");

/** PENDING with no worker pickup — usually Redis/worker down. */
const PENDING_STALE_MS = 45_000;
/**
 * RUNNING with a stale heartbeat — a live worker attempt refreshes startedAt
 * every 15s (see chat-run/execute.ts), including while long Zoo tools are in
 * flight. Minutes of silence therefore means the process died, and the run
 * can be failed fast instead of holding the AI edit lock for ages.
 */
const RUNNING_STALE_MS = 3 * 60_000;

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
    // startedAt doubles as the worker heartbeat, so this measures liveness.
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

  const candidates = [
    ...pendingRows.map((run) => ({
      run,
      where: pendingWhere,
      error: "Timed out waiting for worker (check Redis / chat worker)",
    })),
    ...runningRows.map((run) => ({
      run,
      where: runningWhere,
      error: "Timed out (stale run)",
    })),
  ];
  const transitions = await Promise.all(
    candidates.map(async ({ run, where, error }): Promise<ExpiredRun | null> => {
      const result = await db.chatRun.updateMany({
        // Cancellation, completion, a worker claim, or a fresh heartbeat may
        // have won since the read. Recheck the same stale predicate atomically.
        where: { ...where, id: run.id },
        data: { status: "ERROR", error, finishedAt: new Date() },
      });
      return result.count > 0 ? { ...run, error } : null;
    }),
  );
  return transitions.filter((run): run is ExpiredRun => run !== null);
}

async function persistAndBroadcastExpired(expired: ExpiredRun[]): Promise<void> {
  await Promise.all(
    expired.map(async (run) => {
      try {
        let inputMessages: UIMessage[] = [];
        try {
          inputMessages = await validateResumableUIMessages(run.inputMessages as unknown[]);
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
        log.error("failed to persist stale run", { runId: run.id, err });
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
