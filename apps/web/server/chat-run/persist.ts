/**
 * Chat history persistence.
 *
 * History is append-only for AI runs: a run may add messages but must never
 * rewrite or remove ones already stored (except richer parts merges). Human
 * message edit/delete go through dedicated chat router procedures.
 */
import { prisma, type Prisma } from "@foundry/db";
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import {
  ASSISTANT_CANCELLED_TEXT,
  CANCELLED_TOOL_ERROR_TEXT,
  markCancelledAssistantMessages,
  markFailedAssistantMessages,
  mergeTranscriptPreferringUserTurns,
} from "@/lib/copilot/messages";
import {
  historyRowToUIMessage,
  readChatMeta,
  type ChatHistoryRow,
  type ChatReactionSummary,
} from "@/lib/copilot/chat-message-meta";
import { createLogger } from "@foundry/observability";

const log = createLogger("chat-run");

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

export type StoredMessage = ChatHistoryRow;

export { historyRowToUIMessage as storedMessageToUIMessage };

function metaFromMessage(message: UIMessage): {
  authorUserId: string | null;
  replyToId: string | null;
} {
  const meta = readChatMeta(message);
  return {
    authorUserId:
      message.role === "user"
        ? typeof meta.authorUserId === "string" && meta.authorUserId
          ? meta.authorUserId
          : null
        : null,
    replyToId: typeof meta.replyToId === "string" && meta.replyToId ? meta.replyToId : null,
  };
}

function previewTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const texts: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; text?: string };
    if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
      texts.push(p.text.trim());
    }
  }
  const joined = texts.join(" ").replace(/\s+/g, " ").trim();
  return joined.length > 160 ? `${joined.slice(0, 157)}…` : joined;
}

function summarizeReactions(
  rows: Array<{ emoji: string; userId: string }> | undefined,
  viewerUserId?: string,
): ChatReactionSummary[] {
  const byEmoji = new Map<string, { count: number; me: boolean }>();
  for (const row of rows ?? []) {
    const cur = byEmoji.get(row.emoji) ?? { count: 0, me: false };
    cur.count += 1;
    if (viewerUserId && row.userId === viewerUserId) cur.me = true;
    byEmoji.set(row.emoji, cur);
  }
  return [...byEmoji.entries()]
    .map(([emoji, v]) => ({ emoji, count: v.count, me: v.me }))
    .sort((a, b) => a.emoji.localeCompare(b.emoji));
}

/** Newest `CHAT_HISTORY_LIMIT` messages, returned oldest-first for rendering. */
export async function loadChannelHistory(
  projectId: string,
  channelId: string,
  viewerUserId?: string,
): Promise<StoredMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { projectId, channelId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CHAT_HISTORY_LIMIT,
    select: {
      id: true,
      role: true,
      parts: true,
      authorUserId: true,
      replyToId: true,
      editedAt: true,
      deletedAt: true,
      createdAt: true,
      author: { select: { id: true, name: true, avatarUrl: true } },
      replyTo: {
        select: {
          id: true,
          role: true,
          parts: true,
          deletedAt: true,
          author: { select: { name: true } },
        },
      },
      reactions: { select: { emoji: true, userId: true } },
    },
  });

  return rows.reverse().map((row) => {
    const replyTo = row.replyTo;
    return {
      id: row.id,
      role: row.role,
      parts: row.parts,
      authorUserId: row.authorUserId,
      authorName: row.author?.name ?? null,
      authorAvatarUrl: row.author?.avatarUrl ?? null,
      replyToId: row.replyToId,
      replyPreview: replyTo
        ? {
            id: replyTo.id,
            authorName:
              replyTo.author?.name ?? (replyTo.role === "assistant" ? "Foundry Copilot" : "Member"),
            text: replyTo.deletedAt
              ? "Message deleted"
              : previewTextFromParts(replyTo.parts) || "…",
          }
        : null,
      editedAt: row.editedAt?.toISOString() ?? null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      reactions: summarizeReactions(row.reactions, viewerUserId),
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/**
 * Insert any message we haven't stored yet, keyed on the client-supplied id.
 */
export async function saveNewMessages(scope: ChannelScope, messages: UIMessage[]): Promise<number> {
  const rows = messages
    .filter((message) => message.id && message.parts.length > 0)
    .map((message, index) => {
      const { authorUserId, replyToId } = metaFromMessage(message);
      return {
        id: message.id,
        projectId: scope.projectId,
        branchId: scope.branchId,
        channelId: scope.channelId,
        role: message.role,
        parts: message.parts as unknown as Prisma.InputJsonValue,
        authorUserId,
        replyToId,
        createdAt: new Date(Date.now() + index),
      };
    });

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

function mergeMessageParts(message: UIMessage, existing: unknown): UIMessage["parts"] {
  if (!Array.isArray(existing)) return message.parts;
  const completed = new Map(
    message.parts.flatMap((part) =>
      (part.type.startsWith("tool-") || part.type === "dynamic-tool") &&
      "state" in part &&
      part.state === "output-available" &&
      "toolCallId" in part
        ? [[part.toolCallId, part] as const]
        : [],
    ),
  );
  const stored = {
    ...message,
    parts: (existing as UIMessage["parts"]).map((part) =>
      "toolCallId" in part && "errorText" in part && part.errorText === CANCELLED_TOOL_ERROR_TEXT
        ? (completed.get(part.toolCallId) ?? part)
        : part,
    ),
  };
  // Keep completed tools even when a later checkpoint contains a longer draft.
  const merged = mergeTranscriptPreferringUserTurns([stored], [message])[0] ?? stored;
  const hasStopped = merged.parts.some(
    (part) => part.type === "text" && part.text === ASSISTANT_CANCELLED_TEXT,
  );
  // A checkpoint can arrive after cancellation with a newly started tool that
  // wasn't in the cancellation snapshot. A stopped message stays stopped.
  return hasStopped ? markCancelledAssistantMessages([merged])[0]!.parts : merged.parts;
}

/**
 * Insert missing messages without overwriting concurrent writes, then merge
 * against the exact stored body. Compare-and-swap prevents an older checkpoint
 * that read before cancellation from reviving pending tools afterwards.
 */
export async function persistRunMessages(
  scope: ChannelScope,
  messages: UIMessage[],
): Promise<number> {
  const rows = messages.filter((message) => message.id && message.parts.length > 0);
  if (rows.length === 0) return 0;

  let count = await saveNewMessages(scope, rows);
  let pending = new Map(rows.map((message) => [message.id, message]));
  for (let attempt = 0; pending.size > 0 && attempt < 4; attempt++) {
    const existing = await prisma.chatMessage.findMany({
      where: { ...scope, id: { in: [...pending.keys()] } },
      select: { id: true, parts: true, authorUserId: true, replyToId: true },
    });
    const writes = [];
    const attempted: UIMessage[] = [];
    for (const previous of existing) {
      const message = pending.get(previous.id)!;
      const parts = mergeMessageParts(message, previous.parts);
      const { authorUserId, replyToId } = metaFromMessage(message);
      const fillAuthor = authorUserId && !previous.authorUserId;
      const fillReply = replyToId && !previous.replyToId;
      if (JSON.stringify(parts) === JSON.stringify(previous.parts) && !fillAuthor && !fillReply)
        continue;
      attempted.push(message);
      writes.push(
        prisma.chatMessage.updateMany({
          where: {
            id: message.id,
            ...scope,
            parts: { equals: previous.parts as Prisma.InputJsonValue },
            authorUserId: previous.authorUserId,
            replyToId: previous.replyToId,
          },
          data: {
            parts: parts as unknown as Prisma.InputJsonValue,
            ...(fillAuthor ? { authorUserId } : {}),
            ...(fillReply ? { replyToId } : {}),
          },
        }),
      );
    }
    if (writes.length === 0) return count;
    const results = await prisma.$transaction(writes);
    const retry = new Map<string, UIMessage>();
    results.forEach((result, index) => {
      if (result.count > 0) count += result.count;
      else {
        const message = attempted[index]!;
        retry.set(message.id, message);
      }
    });
    pending = retry;
  }
  if (pending.size > 0)
    throw new Error("Chat history changed during persistence; retry the checkpoint.");
  return count;
}

export async function persistCancelledRunFromEvents(params: {
  runId: string;
  scope: ChannelScope;
  inputMessages: UIMessage[];
}): Promise<number> {
  const rebuilt = await rebuildUiMessagesFromRunEvents(params.runId, params.inputMessages);
  return persistRunMessages(params.scope, markCancelledAssistantMessages(rebuilt));
}

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

export async function checkpointRunMessages(params: {
  runId: string;
  scope: ChannelScope;
  inputMessages: UIMessage[];
}): Promise<UIMessage[]> {
  let rebuilt = await rebuildUiMessagesFromRunEvents(params.runId, params.inputMessages);
  const run = await prisma.chatRun.findUnique({
    where: { id: params.runId },
    select: { status: true, error: true },
  });
  if (run?.status === "CANCELLED") rebuilt = markCancelledAssistantMessages(rebuilt);
  else if (run?.status === "ERROR")
    rebuilt = markFailedAssistantMessages(rebuilt, run.error ?? "Run failed");
  if (rebuilt === params.inputMessages) return rebuilt;
  await persistRunMessages(params.scope, rebuilt);
  return rebuilt;
}

function toolCallIds(parts: unknown): string[] {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap((part: unknown) => {
    if (!part || typeof part !== "object") return [];
    const value = part as Record<string, unknown>;
    return typeof value.type === "string" &&
      (value.type.startsWith("tool-") || value.type === "dynamic-tool") &&
      typeof value.toolCallId === "string" &&
      value.toolCallId
      ? [value.toolCallId]
      : [];
  });
}

async function legacyAssistantMessageId(runId: string, message: UIMessage): Promise<string> {
  const fallback = `assistant_${runId}`;
  const replayedIds = toolCallIds(message.parts);
  if (replayedIds.length === 0) return fallback;
  const run = await prisma.chatRun.findUnique({
    where: { id: runId },
    select: { projectId: true, channelId: true },
  });
  if (!run) return fallback;
  // Old SDK streams omitted messageId, while the browser later saved its own
  // ID. Reuse that row only when the tool-call IDs identify it unambiguously.
  const candidates = await prisma.chatMessage.findMany({
    where: {
      projectId: run.projectId,
      channelId: run.channelId,
      role: "assistant",
      deletedAt: null,
      parts: { array_contains: [{ toolCallId: replayedIds[0]! }] },
    },
    select: { id: true, parts: true },
  });
  const matches = candidates.filter((candidate) => {
    const storedIds = toolCallIds(candidate.parts);
    if (storedIds.length === 0) return false;
    const shorter = storedIds.length < replayedIds.length ? storedIds : replayedIds;
    const longer = storedIds.length < replayedIds.length ? replayedIds : storedIds;
    return shorter.every((id, index) => longer[index] === id);
  });
  return matches.length === 1 ? matches[0]!.id : fallback;
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
    log.warn("rebuild from events failed", { runId, err });
    // A malformed final chunk must not erase valid text/tool work replayed so far.
  }

  if (!last || last.parts.length === 0) return originalMessages;
  if (!last.id) last = { ...last, id: await legacyAssistantMessageId(runId, last) };

  const tail = originalMessages[originalMessages.length - 1];
  if (tail?.role === "assistant" && tail.id === last.id) {
    return [...originalMessages.slice(0, -1), last];
  }
  return [...originalMessages, last];
}
