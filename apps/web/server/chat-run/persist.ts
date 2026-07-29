/**
 * Chat history persistence.
 *
 * History is append-only for AI runs: a run may add messages but must never
 * rewrite or remove ones already stored (except richer parts merges). Human
 * message edit/delete go through dedicated chat router procedures.
 */
import { prisma, type Prisma } from "@foundry/db";
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { markFailedAssistantMessages } from "@/lib/copilot/messages";
import {
  historyRowToUIMessage,
  readChatMeta,
  type ChatHistoryRow,
  type ChatReactionSummary,
} from "@/lib/copilot/chat-message-meta";

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
        ? (typeof meta.authorUserId === "string" && meta.authorUserId
            ? meta.authorUserId
            : null)
        : null,
    replyToId:
      typeof meta.replyToId === "string" && meta.replyToId ? meta.replyToId : null,
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
              replyTo.author?.name ??
              (replyTo.role === "assistant" ? "Foundry Copilot" : "Member"),
            text: replyTo.deletedAt ? "Message deleted" : previewTextFromParts(replyTo.parts) || "…",
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

function preferIncomingParts(existing: unknown, incoming: unknown): boolean {
  return messagePartsScore(incoming) >= messagePartsScore(existing);
}

/**
 * Authoritative write from the chat worker (and client safety net): create or
 * update message parts, but NEVER replace a richer stored body with a thinner
 * one. Also backfills author/reply when the stored row is missing them.
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
    select: { id: true, parts: true, authorUserId: true, replyToId: true },
  });
  const existingById = new Map(existing.map((row) => [row.id, row]));

  const now = Date.now();
  const ops = [];
  for (let index = 0; index < rows.length; index++) {
    const message = rows[index]!;
    const prev = existingById.get(message.id);
    const { authorUserId, replyToId } = metaFromMessage(message);
    if (prev !== undefined && !preferIncomingParts(prev.parts, message.parts)) {
      // Still backfill authorship if the richer row lacks it.
      if (authorUserId && !prev.authorUserId) {
        ops.push(
          prisma.chatMessage.update({
            where: { id: message.id },
            data: {
              authorUserId,
              ...(replyToId && !prev.replyToId ? { replyToId } : {}),
            },
          }),
        );
      }
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
          authorUserId,
          replyToId,
          createdAt: new Date(now + index),
        },
        update: {
          parts: message.parts as unknown as Prisma.InputJsonValue,
          ...(authorUserId ? { authorUserId } : {}),
          ...(replyToId ? { replyToId } : {}),
        },
      }),
    );
  }

  if (ops.length === 0) return 0;
  await prisma.$transaction(ops);
  return ops.length;
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
