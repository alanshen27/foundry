/**
 * Browser-only chat safety net. Survives reload when POST /api/ai/chat never
 * reaches Postgres (401 Auth rate-limit, network blip) or useChat rolls back
 * the optimistic user turn before the server write lands.
 */
import type { UIMessage } from "ai";
import { mergeTranscriptPreferringUserTurns } from "./messages";

const STORAGE_PREFIX = "foundry:chat-local:";
const MAX_MESSAGES = 120;

function storageKey(channelId: string): string {
  return `${STORAGE_PREFIX}${channelId}`;
}

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

export function readLocalTranscript(channelId: string): UIMessage[] {
  if (!canUseSessionStorage()) return [];
  try {
    const raw = sessionStorage.getItem(storageKey(channelId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is UIMessage =>
        !!m &&
        typeof m === "object" &&
        typeof (m as UIMessage).id === "string" &&
        typeof (m as UIMessage).role === "string" &&
        Array.isArray((m as UIMessage).parts),
    );
  } catch {
    return [];
  }
}

/**
 * Merge `messages` into the session backup. Never replaces a non-empty backup
 * with an empty snapshot (useChat often clears the UI on transport errors).
 */
export function writeLocalTranscript(channelId: string, messages: UIMessage[]): void {
  if (!canUseSessionStorage()) return;
  const prev = readLocalTranscript(channelId);
  if (messages.length === 0) {
    // Keep whatever we already stashed — empty means "UI rolled back", not "clear chat".
    return;
  }
  const merged = mergeTranscriptPreferringUserTurns(messages, prev).slice(-MAX_MESSAGES);
  try {
    sessionStorage.setItem(storageKey(channelId), JSON.stringify(merged));
  } catch {
    // Quota / private mode — ignore; server persist remains the primary path.
  }
}

/** Seed the live chat from RSC history + any turns only the browser still has. */
export function seedTranscriptWithLocalBackup(
  channelId: string,
  serverMessages: UIMessage[],
): UIMessage[] {
  const local = readLocalTranscript(channelId);
  const merged = mergeTranscriptPreferringUserTurns(serverMessages, local);
  writeLocalTranscript(channelId, merged);
  return merged;
}
