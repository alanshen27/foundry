import "server-only";

import { copilotBroadcastChannel } from "@foundry/realtime";
import { prisma } from "@foundry/db";
import type { UIMessageChunk } from "ai";
import { getBroadcastPublisher } from "../realtime";
import type { RunEventWrite } from "./event-writer";

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
 * Persist a stream chunk for SSE replay.
 *
 * Upsert so a deploy reclaim / dual-pickup that reuses seq numbers cannot
 * crash the whole run with P2002 on (runId, seq).
 */
export async function publishRunChunk(
  runId: string,
  _channelId: string,
  seq: number,
  chunk: UIMessageChunk,
): Promise<void> {
  await prisma.chatRunEvent.upsert({
    where: { runId_seq: { runId, seq } },
    create: { runId, seq, chunk: chunk as object },
    // Keep the first write — replays must stay stable for SSE reconnect.
    update: {},
  });
}

/**
 * SSE reads these rows directly. No client consumes per-chunk broadcasts;
 * subscribing/sending/unsubscribing for every token delayed replies by minutes.
 * A batch commits together, so SSE cannot skip an earlier uncommitted sequence.
 */
export async function publishRunChunks(runId: string, events: RunEventWrite[]): Promise<void> {
  if (events.length === 0) return;
  await prisma.chatRunEvent.createMany({
    data: events.map(({ seq, chunk }) => ({ runId, seq, chunk: chunk as object })),
    skipDuplicates: true,
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
