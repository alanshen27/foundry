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
 * Authoritative write from the chat worker: create or update message parts.
 *
 * Unlike `saveNewMessages`, this intentionally overwrites parts so a failed
 * run can stamp `Failed: …` onto an assistant turn that was partially streamed
 * (and so timeout reclaim can persist whatever chunks already landed).
 */
export async function persistRunMessages(
  scope: ChannelScope,
  messages: UIMessage[],
): Promise<number> {
  const rows = messages.filter((message) => message.id && message.parts.length > 0);
  if (rows.length === 0) return 0;

  const now = Date.now();
  await prisma.$transaction(
    rows.map((message, index) =>
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
    ),
  );
  return rows.length;
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
