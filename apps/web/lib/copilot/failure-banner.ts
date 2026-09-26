import type { UIMessage } from "ai";
import { isMessageDeleted } from "./chat-message-meta";
import { ASSISTANT_FAILURE_PREFIX } from "./messages";

/** Keep transport errors visible until the current turn already shows the same failure. */
export function shouldShowStandaloneChatError(
  messages: UIMessage[],
  error: { message: string } | null | undefined,
): boolean {
  if (!error) return false;
  const label = `${ASSISTANT_FAILURE_PREFIX}${error.message.trim()}`;
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]!.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return true;
  const userId = messages[lastUserIndex]!.id;
  return !messages.slice(lastUserIndex + 1).some((message) => {
    if (message.role !== "assistant" || isMessageDeleted(message)) return false;
    // A delayed legacy safety-net write may belong to an earlier user turn.
    if (message.id.startsWith("fail_") && message.id !== `fail_${userId}`) return false;
    return message.parts.some((part) => part.type === "text" && part.text.trim() === label);
  });
}
