/**
 * Chat history persistence.
 *
 * History is append-only: a run may add messages but must never rewrite or
 * remove ones already stored. The previous implementation replaced the whole
 * channel with whatever the client happened to be holding, so anything the
 * client had not loaded — or that sanitization had stripped — was destroyed.
 */
import { prisma, type Prisma } from "@foundry/db";
import type { UIMessage } from "ai";

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
