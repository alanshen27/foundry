/**
 * Chat history persistence.
 *
 * History is append-only: a run may add messages but must never rewrite or
 * remove ones already stored. The previous implementation replaced the whole
 * channel with whatever the client happened to be holding, so anything the
 * client had not loaded — or that sanitization had stripped — was destroyed.
 */
import { prisma, type Prisma } from "@foundry/db";
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { markFailedAssistantMessages } from "@/lib/copilot/messages";

/**
 * How many messages a client loads. Reads take the newest N: with an
 * append-only history a channel grows forever, and the tail is what matters.
 */
export const CHAT_HISTORY_LIMIT = 500;

export type ChannelScope = {
  projectId: string;
  branchId: string;
  channelId: string;
};

export type StoredMessage = {
  id: string;
  role: string;
  parts: unknown;
};

/** Newest `CHAT_HISTORY_LIMIT` messages, returned oldest-first for rendering. */
export async function loadChannelHistory(
  projectId: string,
  channelId: string,
): Promise<StoredMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { projectId, channelId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CHAT_HISTORY_LIMIT,
    select: { id: true, role: true, parts: true },
  });
  return rows.reverse();
}

/**
 * Insert any message we haven't stored yet, keyed on the client-supplied id.
 *
 * Messages already in the table are left exactly as they were rather than being
 * overwritten. That matters because the copy passed in here has been through
 * `sanitizeUiMessagesForModel` (and possibly `stripAllToolParts`), which drops
 * in-flight tool parts to keep the model prompt valid — writing that back would
 * quietly erase completed tool cards from earlier turns.
 */
export async function saveNewMessages(scope: ChannelScope, messages: UIMessage[]): Promise<number> {
  const rows = messages
    .filter((message) => message.id && message.parts.length > 0)
    .map((message, index) => ({
      id: message.id,
      projectId: scope.projectId,
      branchId: scope.branchId,
      channelId: scope.channelId,
      role: message.role,
      parts: message.parts as unknown as Prisma.InputJsonValue,
      // Stagger so `orderBy createdAt` keeps the array's order.
      createdAt: new Date(Date.now() + index),
    }));

  if (rows.length === 0) return 0;

  const result = await prisma.chatMessage.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * How "complete" a message body is. Used so a thin client snapshot (or a
 * mid-stream rebuild) can never clobber a richer row already in Postgres.
 */
export function messagePartsScore(parts: unknown): number {
  if (!Array.isArray(parts)) return 0;
  let score = parts.length * 1_000;
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const type = typeof p.type === "string" ? p.type : "";
    if (type === "text" && typeof p.text === "string") {
      score += p.text.length;
      continue;
    }
    const isTool = type.startsWith("tool-") || type === "dynamic-tool";
    if (!isTool) continue;
    const state = typeof p.state === "string" ? p.state : "";
    if (state === "output-available") score += 800;
    else if (state === "output-error") score += 700;
    else if (state === "input-available") score += 300;
    else score += 100;
    if (p.output != null) score += 200 + JSON.stringify(p.output).length;
    if (typeof p.errorText === "string") score += p.errorText.length;
    if (p.input != null) score += Math.min(JSON.stringify(p.input).length, 2_000);
  }
  return score;
}

function preferIncomingParts(existing: unknown, incoming: unknown): boolean {
  return messagePartsScore(incoming) >= messagePartsScore(existing);
}

/**
 * Authoritative write from the chat worker (and client safety net): create or
 * update message parts, but NEVER replace a richer stored body with a thinner
 * one. Client mid-stream snapshots used to wipe completed tool cards / text.
 */
export async function persistRunMessages(
  scope: ChannelScope,
  messages: UIMessage[],
): Promise<number> {
  const rows = messages.filter((message) => message.id && message.parts.length > 0);
  if (rows.length === 0) return 0;

  const ids = rows.map((m) => m.id);
  const existing = await prisma.chatMessage.findMany({
    where: { id: { in: ids } },
    select: { id: true, parts: true },
  });
  const existingById = new Map(existing.map((row) => [row.id, row.parts]));

  const now = Date.now();
  const ops = [];
  for (let index = 0; index < rows.length; index++) {
    const message = rows[index]!;
    const prev = existingById.get(message.id);
    if (prev !== undefined && !preferIncomingParts(prev, message.parts)) {
      // Keep the richer DB copy — incoming is a downgrade.
      continue;
    }
    ops.push(
      prisma.chatMessage.upsert({
        where: { id: message.id },
        create: {
          id: message.id,
          projectId: scope.projectId,
          branchId: scope.branchId,
          channelId: scope.channelId,
          role: message.role,
          parts: message.parts as unknown as Prisma.InputJsonValue,
          createdAt: new Date(now + index),
        },
        update: {
          parts: message.parts as unknown as Prisma.InputJsonValue,
        },
      }),
    );
  }

  if (ops.length === 0) return 0;
  await prisma.$transaction(ops);
  return ops.length;
}

/**
 * Rebuild the UI transcript for a run from persisted SSE chunks, then optionally
 * stamp a failure note. Used when the worker dies mid-stream (onEnd never ran).
 */
export async function persistFailedRunFromEvents(params: {
  runId: string;
  scope: ChannelScope;
  inputMessages: UIMessage[];
  error: string;
}): Promise<number> {
  const rebuilt = await rebuildUiMessagesFromRunEvents(params.runId, params.inputMessages);
  const stamped = markFailedAssistantMessages(rebuilt, params.error);
  return persistRunMessages(params.scope, stamped);
}

/**
 * Rebuild + upsert whatever the run has streamed so far. Safe to call often
 * during a long Zoo tool call so a browser reload doesn't wipe the turn.
 */
export async function checkpointRunMessages(params: {
  runId: string;
  scope: ChannelScope;
  inputMessages: UIMessage[];
}): Promise<UIMessage[]> {
  const rebuilt = await rebuildUiMessagesFromRunEvents(params.runId, params.inputMessages);
  if (rebuilt === params.inputMessages) return rebuilt;
  await persistRunMessages(params.scope, rebuilt);
  return rebuilt;
}

export async function rebuildUiMessagesFromRunEvents(
  runId: string,
  originalMessages: UIMessage[],
): Promise<UIMessage[]> {
  const events = await prisma.chatRunEvent.findMany({
    where: { runId },
    orderBy: { seq: "asc" },
    select: { chunk: true },
  });
  if (events.length === 0) return originalMessages;

  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(event.chunk as UIMessageChunk);
      }
      controller.close();
    },
  });

  let last: UIMessage | undefined;
  try {
    for await (const message of readUIMessageStream({
      stream,
      terminateOnError: false,
    })) {
      last = message;
    }
  } catch (err) {
    console.warn(`[chat-run] rebuild from events failed run=${runId}`, err);
    return originalMessages;
  }

  if (!last || last.parts.length === 0) return originalMessages;

  const tail = originalMessages[originalMessages.length - 1];
  if (tail?.role === "assistant" && tail.id === last.id) {
    return [...originalMessages.slice(0, -1), last];
  }
  return [...originalMessages, last];
}
