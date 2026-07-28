import "server-only";

import { copilotBroadcastChannel } from "@foundry/realtime";
import { prisma } from "@foundry/db";
import type { UIMessageChunk } from "ai";
import { getBroadcastPublisher } from "../realtime";

/** Persist a stream chunk and fan it out to every connected client. */
export async function publishRunChunk(
  runId: string,
  channelId: string,
  seq: number,
  chunk: UIMessageChunk,
): Promise<void> {
  await prisma.chatRunEvent.create({
    data: { runId, seq, chunk: chunk as object },
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
): Promise<void> {
  await getBroadcastPublisher().publish(copilotBroadcastChannel(channelId), {
    event: "run-finished",
    payload: { runId, status },
  });
}
