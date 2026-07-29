/**
 * Foundry chat message metadata carried on AI SDK UIMessage.metadata and
 * mirrored into ChatMessage columns for authorship / reply / soft-delete.
 */
import type { UIMessage } from "ai";

export const CHAT_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉"] as const;
export type ChatReactionEmoji = (typeof CHAT_REACTION_EMOJIS)[number];

export function isChatReactionEmoji(value: string): value is ChatReactionEmoji {
  return (CHAT_REACTION_EMOJIS as readonly string[]).includes(value);
}

export type ChatReactionSummary = {
  emoji: string;
  count: number;
  me: boolean;
};

export type ChatReplyPreview = {
  id: string;
  authorName: string;
  text: string;
};

export type ChatMessageMeta = {
  authorUserId?: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  replyToId?: string | null;
  replyPreview?: ChatReplyPreview | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  reactions?: ChatReactionSummary[];
};

/** Row shape returned by chat.messages / loadChannelHistory. */
export type ChatHistoryRow = {
  id: string;
  role: string;
  parts: unknown;
  authorUserId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  replyToId: string | null;
  replyPreview: ChatReplyPreview | null;
  editedAt: string | null;
  deletedAt: string | null;
  reactions: ChatReactionSummary[];
  createdAt: string;
};

export type FoundryUIMessage = UIMessage<ChatMessageMeta>;

export function readChatMeta(message: UIMessage | FoundryUIMessage): ChatMessageMeta {
  const raw = message.metadata;
  if (!raw || typeof raw !== "object") return {};
  return raw as ChatMessageMeta;
}

export function withChatMeta(
  message: UIMessage,
  patch: Partial<ChatMessageMeta>,
): FoundryUIMessage {
  return {
    ...message,
    metadata: { ...readChatMeta(message), ...patch },
  };
}

export function historyRowToUIMessage(row: ChatHistoryRow): FoundryUIMessage {
  const metadata: ChatMessageMeta = {
    authorUserId: row.authorUserId,
    authorName: row.authorName,
    authorAvatarUrl: row.authorAvatarUrl,
    replyToId: row.replyToId,
    replyPreview: row.replyPreview,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    reactions: row.reactions,
  };
  return {
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: (row.deletedAt
      ? [{ type: "text", text: "Message deleted" }]
      : row.parts) as UIMessage["parts"],
    metadata,
  };
}

export function messageAuthorKey(message: UIMessage): string {
  if (message.role === "assistant") return "assistant";
  const meta = readChatMeta(message);
  return meta.authorUserId?.trim() || `anon:${message.id}`;
}

export function messageDisplayName(message: UIMessage, copilotName = "Foundry Copilot"): string {
  if (message.role === "assistant") return copilotName;
  const meta = readChatMeta(message);
  const name = meta.authorName?.trim();
  return name || "Member";
}

export function messagePlainText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

export function isOwnUserMessage(message: UIMessage, viewerId: string): boolean {
  if (message.role !== "user") return false;
  const authorId = readChatMeta(message).authorUserId;
  return Boolean(authorId && authorId === viewerId);
}

export function isMessageDeleted(message: UIMessage): boolean {
  return Boolean(readChatMeta(message).deletedAt);
}

/** Stamp authorship only on the newest user turn (never rewrite teammates). */
export function stampLatestUserAuthor(
  messages: UIMessage[],
  author: { id: string; name: string; avatarUrl?: string | null },
): FoundryUIMessage[] {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) return messages as FoundryUIMessage[];

  return messages.map((message, index) => {
    if (index !== lastUserIndex) return message as FoundryUIMessage;
    const meta = readChatMeta(message);
    return withChatMeta(message, {
      authorUserId: meta.authorUserId || author.id,
      authorName: meta.authorName || author.name,
      authorAvatarUrl: meta.authorAvatarUrl ?? author.avatarUrl ?? null,
    });
  });
}
