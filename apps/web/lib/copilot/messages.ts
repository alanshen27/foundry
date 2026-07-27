import { isToolUIPart, type ModelMessage, type UIMessage } from "ai";

/** Terminal tool states that include a result the model can consume. */
const COMPLETE_TOOL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
]);

function isToolPart(part: UIMessage["parts"][number]): boolean {
  return isToolUIPart(part) || part.type.startsWith("tool-");
}

/** Tools OpenAI runs itself; their results replay as item references, not content. */
const PROVIDER_EXECUTED_TOOL_TYPES = new Set(["tool-web_search", "tool-tool_search"]);

/** Deep-clone via JSON so Date/etc. become prompt-safe primitives. */
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Drop incomplete tool parts (interrupted runs, approval mid-flight, etc.).
 * `ignoreIncompleteToolCalls` only strips input-streaming / input-available;
 * approval-* and other mid-states still produce orphan tool-calls and trip
 * AI_MissingToolResultsError inside convertToLanguageModelPrompt.
 *
 * Reasoning parts go too: OpenAI replays them as `item_reference` ids (rs_…)
 * that only resolve inside the response that produced them, so a cancelled or
 * expired run poisons every later turn with 404 "Item with id 'rs_…' not
 * found". Reasoning text carries no value across turns.
 *
 * Also JSON-clones completed tool outputs so Prisma Date fields never reach
 * the AI SDK prompt validator (AI_InvalidPromptError / expected string, got Date).
 */
export function sanitizeUiMessagesForModel(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((message) => ({
      ...message,
      parts: message.parts
        .filter((part) => {
          if (part.type === "reasoning") return false;
          if (!isToolPart(part)) return true;
          if (!isToolUIPart(part)) return false;
          return COMPLETE_TOOL_STATES.has(part.state);
        })
        .map((part) => {
          if (!isToolUIPart(part)) return part;
          if (!("output" in part) || part.output === undefined) return part;
          try {
            return { ...part, output: jsonSafe(part.output) };
          } catch {
            return part;
          }
        }),
    }))
    .filter((message) => message.parts.length > 0);
}

/**
 * Drop results from tools OpenAI executed server-side. Like reasoning, they
 * replay as item references (ws_…) instead of inline content, so a stale id
 * 404s the whole request — but unlike reasoning they're worth keeping until
 * the API actually rejects them.
 */
export function stripProviderExecutedToolParts(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((message) => ({
      ...message,
      parts: message.parts.filter((part) => !PROVIDER_EXECUTED_TOOL_TYPES.has(part.type)),
    }))
    .filter((message) => message.parts.length > 0);
}

/** Nuclear option: drop every tool part so a poisoned transcript can still run. */
export function stripAllToolParts(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((message) => ({
      ...message,
      parts: message.parts.filter((part) => !isToolPart(part)),
    }))
    .filter((message) => message.parts.length > 0);
}

/**
 * Belt-and-suspenders: remove assistant tool-calls that have no matching
 * tool-result after convertToModelMessages.
 */
export function stripOrphanToolCalls(messages: ModelMessage[]): ModelMessage[] {
  const resultIds = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "tool-result" &&
        "toolCallId" in part &&
        typeof part.toolCallId === "string"
      ) {
        resultIds.add(part.toolCallId);
      }
    }
  }

  return messages
    .map((message) => {
      if (message.role !== "assistant" || !Array.isArray(message.content)) {
        return message;
      }
      const content = message.content.filter((part) => {
        if (typeof part !== "object" || part === null || !("type" in part)) {
          return true;
        }
        if (part.type === "tool-call" || part.type === "tool-approval-request") {
          return (
            "toolCallId" in part &&
            typeof part.toolCallId === "string" &&
            resultIds.has(part.toolCallId)
          );
        }
        return true;
      });
      return { ...message, content };
    })
    .filter((message) => {
      if (!Array.isArray(message.content)) return true;
      return message.content.length > 0;
    }) as ModelMessage[];
}

/** Drop empty assistant placeholders left behind by failed/aborted runs. */
export function pruneEmptyAssistantMessages(messages: UIMessage[]): UIMessage[] {
  return messages.filter((message) => {
    if (message.role !== "assistant") return true;
    return message.parts.some((part) => {
      if (part.type === "text") return part.text.trim().length > 0;
      if (isToolPart(part)) return true;
      return false;
    });
  });
}
