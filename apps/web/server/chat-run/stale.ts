import "server-only";

import { prisma } from "@foundry/db";

/** PENDING with no worker pickup — usually Redis/worker down. */
const PENDING_STALE_MS = 45_000;
/**
 * RUNNING without finishing — worker crashed mid-stream. A single Zoo
 * text_to_cad job polls for up to ~10 minutes and emits no chunks while it
 * waits, so this has to sit above that or long CAD runs get killed mid-flight.
 */
const RUNNING_STALE_MS = 12 * 60_000;

/**
 * Mark stuck chat runs as ERROR so the UI isn't permanently "busy"
 * and new messages can be sent.
 */
export async function expireStaleChatRuns(channelId: string): Promise<number> {
  const now = Date.now();
  const [pending, running] = await Promise.all([
    prisma.chatRun.updateMany({
      where: {
        channelId,
        status: "PENDING",
        createdAt: { lt: new Date(now - PENDING_STALE_MS) },
      },
      data: {
        status: "ERROR",
        error: "Timed out waiting for worker (check Redis / chat worker)",
        finishedAt: new Date(),
      },
    }),
    prisma.chatRun.updateMany({
      where: {
        channelId,
        status: "RUNNING",
        // Measure from pickup, not enqueue, so queue wait doesn't count.
        OR: [
          { startedAt: { lt: new Date(now - RUNNING_STALE_MS) } },
          { startedAt: null, createdAt: { lt: new Date(now - RUNNING_STALE_MS) } },
        ],
      },
      data: {
        status: "ERROR",
        error: "Timed out (stale run)",
        finishedAt: new Date(),
      },
    }),
  ]);
  return pending.count + running.count;
}
