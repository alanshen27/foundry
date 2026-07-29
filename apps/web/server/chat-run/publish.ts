import "server-only";

import { copilotBroadcastChannel } from "@foundry/realtime";
import { prisma } from "@foundry/db";
import type { UIMessageChunk } from "ai";
import { getBroadcastPublisher } from "../realtime";

/** Highest seq already stored for a run (0 if none). */
export async function maxRunEventSeq(runId: string): Promise<number> {
  const last = await prisma.chatRunEvent.findFirst({
    where: { runId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return last?.seq ?? 0;
}

/**
 * Persist a stream chunk and fan it out to every connected client.
 *
 * Upsert so a deploy reclaim / dual-pickup that reuses seq numbers cannot
 * crash the whole run with P2002 on (runId, seq).
 */
export async function publishRunChunk(
  runId: string,
  channelId: string,
  seq: number,
  chunk: UIMessageChunk,
): Promise<void> {
  await prisma.chatRunEvent.upsert({
    where: { runId_seq: { runId, seq } },
    create: { runId, seq, chunk: chunk as object },
    // Keep the first write — replays must stay stable for SSE reconnect.
    update: {},
  });
  await getBroadcastPublisher().publish(copilotBroadcastChannel(channelId), {
    event: "chunk",
    payload: { runId, seq, chunk },
  });
}

export async function publishRunStarted(runId: string, channelId: string): Promise<void> {
  await getBroadcastPublisher().publish(copilotBroadcastChannel(channelId), {
    event: "run-started",
    payload: { runId },
  });
}

export async function publishRunFinished(
  runId: string,
  channelId: string,
  status: "done" | "error" | "cancelled",
  error?: string | null,
): Promise<void> {
  await getBroadcastPublisher().publish(copilotBroadcastChannel(channelId), {
    event: "run-finished",
    payload: {
      runId,
      status,
      ...(error?.trim() ? { error: error.trim() } : {}),
    },
  });
}
