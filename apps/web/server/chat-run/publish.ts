import "server-only";

import { getServerEnv } from "@foundry/config";
import {
  copilotBroadcastChannel,
  createOffBroadcastPublisher,
  createSupabaseBroadcastPublisher,
  type BroadcastPublisher,
} from "@foundry/realtime";
import { prisma } from "@foundry/db";
import type { UIMessageChunk } from "ai";

let publisher: BroadcastPublisher | undefined;

export function getBroadcastPublisher(): BroadcastPublisher {
  if (publisher) return publisher;
  const env = getServerEnv();
  if (
    env.NEXT_PUBLIC_REALTIME_MODE === "supabase" &&
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    publisher = createSupabaseBroadcastPublisher({
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
  } else {
    publisher = createOffBroadcastPublisher();
  }
  return publisher;
}

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

