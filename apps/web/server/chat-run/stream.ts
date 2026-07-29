import "server-only";

import { prisma } from "@foundry/db";
import type { UIMessageChunk } from "ai";

export function sseEncode(chunk: UIMessageChunk): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`);
}

export function sseComment(text: string): Uint8Array {
  return new TextEncoder().encode(`: ${text}\n\n`);
}

const TERMINAL = new Set(["DONE", "ERROR", "CANCELLED"]);

/**
 * SSE stream for a single run. Replays persisted chunks, then polls Postgres
 * for new ones until the run reaches a terminal status.
 *
 * DB polling is the durable path (worker and Next.js are separate processes).
 * Realtime broadcast remains a best-effort signal for UI busy state.
 */
export async function createRunEventStream(runId: string): Promise<ReadableStream<Uint8Array>> {
  let lastSeq = 0;
  let closed = false;

  return new ReadableStream({
    async pull(controller) {
      if (closed) return;

      const run = await prisma.chatRun.findUnique({
        where: { id: runId },
        select: { status: true, createdAt: true, startedAt: true, error: true },
      });
      if (!run) {
        controller.close();
        closed = true;
        return;
      }

      // SSE is read-only. Never flip ChatRun → ERROR here — that raced deploys /
      // cold workers and showed "Timed out waiting for worker" while the job was
      // still alive (or about to be reclaimed). Stale expiry owns terminalization.
      // Only disconnect a client that has been waiting on a still-PENDING run.
      const pendingAgeMs = Date.now() - run.createdAt.getTime();
      if (run.status === "PENDING" && pendingAgeMs > 90_000 && lastSeq === 0) {
        controller.enqueue(
          sseEncode({
            type: "error",
            errorText:
              "Still waiting for the chat worker to pick up this run. Keep this tab open, or retry in a moment.",
          }),
        );
        controller.enqueue(sseComment("done"));
        controller.close();
        closed = true;
        return;
      }

      const events = await prisma.chatRunEvent.findMany({
        where: { runId, seq: { gt: lastSeq } },
        orderBy: { seq: "asc" },
      });

      if (events.length === 0) {
        if (TERMINAL.has(run.status)) {
          if (run.status === "ERROR" && run.error?.trim()) {
            controller.enqueue(sseEncode({ type: "error", errorText: run.error.trim() }));
          }
          controller.enqueue(sseComment("done"));
          controller.close();
          closed = true;
          return;
        }
        await sleep(150);
        controller.enqueue(sseComment("keepalive"));
        return;
      }

      for (const event of events) {
        controller.enqueue(sseEncode(event.chunk as UIMessageChunk));
        lastSeq = event.seq;
      }

      if (TERMINAL.has(run.status)) {
        if (run.status === "ERROR" && run.error?.trim()) {
          controller.enqueue(sseEncode({ type: "error", errorText: run.error.trim() }));
        }
        controller.enqueue(sseComment("done"));
        controller.close();
        closed = true;
      }
    },
    cancel() {
      closed = true;
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
