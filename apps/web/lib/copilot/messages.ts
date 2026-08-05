import { isToolUIPart, validateUIMessages, type ModelMessage, type UIMessage } from "ai";

/** Terminal tool states that include a result the model can consume. */
const COMPLETE_TOOL_STATES = new Set(["output-available", "output-error", "output-denied"]);

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
 * Drop OpenAI Responses `itemId`s so history is sent as inline content.
 *
 * The SDK otherwise turns those ids into `item_reference` entries. A single
 * assistant turn (especially after `web_search`) can stamp the same `msg_…`
 * onto several parts, and OpenAI then 400s with "Duplicate item found with
 * id msg_…". We store the full transcript ourselves, so references buy us
 * nothing — and stale ones also 404 after cancelled runs.
 */
function stripOpenAIItemIds<T extends UIMessage["parts"][number]>(part: T): T {
  const scrub = (meta: unknown): unknown => {
    if (!meta || typeof meta !== "object") return meta;
    const next: Record<string, unknown> = { ...(meta as Record<string, unknown>) };
    for (const key of ["openai", "openai.responses"] as const) {
      const block = next[key];
      if (!block || typeof block !== "object") continue;
      const { itemId: _drop, ...rest } = block as Record<string, unknown>;
      if (Object.keys(rest).length === 0) delete next[key];
      else next[key] = rest;
    }
    return Object.keys(next).length === 0 ? undefined : next;
  };

  const patched = { ...part } as T & {
    providerMetadata?: unknown;
    providerOptions?: unknown;
  };
  if ("providerMetadata" in patched) {
    patched.providerMetadata = scrub(patched.providerMetadata);
    if (patched.providerMetadata === undefined) delete patched.providerMetadata;
  }
  if ("providerOptions" in patched) {
    patched.providerOptions = scrub(patched.providerOptions);
    if (patched.providerOptions === undefined) delete patched.providerOptions;
  }
  return patched;
}

/** Shown in place of a tool result a killed run never wrote. */
export const INTERRUPTED_TOOL_ERROR = "Interrupted before this tool reported a result.";

type ToolPartShape = {
  type: string;
  toolCallId?: unknown;
  toolName?: unknown;
  state?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
  providerExecuted?: unknown;
  approval?: unknown;
};

function isDeniedShape(part: ToolPartShape): boolean {
  const approval = part.approval;
  return (
    typeof approval === "object" &&
    approval !== null &&
    (approval as { approved?: unknown }).approved === false
  );
}

/**
 * Rewrite one tool part into a shape the AI SDK message schema accepts, or
 * null when nothing usable is left. A tool call is only replayable as a
 * call/result pair, so anything without a recorded result becomes an errored
 * result rather than a call the next turn has to answer for.
 */
function repairToolPart(
  part: UIMessage["parts"][number],
  reason: string,
): UIMessage["parts"][number] | null {
  const shape = part as ToolPartShape;
  const toolCallId = shape.toolCallId;
  if (typeof toolCallId !== "string" || !toolCallId) return null;
  const isDynamic = shape.type === "dynamic-tool";
  if (isDynamic && typeof shape.toolName !== "string") return null;

  const state = shape.state;
  const errorText = typeof shape.errorText === "string" ? shape.errorText.trim() : "";
  if (state === "output-available" && shape.output !== undefined) return part;
  if (state === "output-error" && errorText && shape.output === undefined) return part;
  if (state === "output-denied" && isDeniedShape(shape) && shape.output === undefined) return part;

  return {
    ...(isDynamic
      ? { type: "dynamic-tool", toolName: shape.toolName }
      : { type: shape.type as `tool-${string}` }),
    toolCallId,
    state: "output-error",
    input: shape.input ?? {},
    errorText: errorText || reason,
    ...(shape.providerExecuted === true ? { providerExecuted: true } : {}),
  } as UIMessage["parts"][number];
}

/**
 * Make a transcript left behind by a killed run usable again.
 *
 * A worker that dies mid-tool (deploy, OOM, cancelled stream) stores the call
 * with no result, and half-written parts can miss fields their state requires
 * — both of which make the next turn fail validation instead of resuming.
 */
export function repairInterruptedToolParts(
  messages: UIMessage[],
  reason: string = INTERRUPTED_TOOL_ERROR,
): UIMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.parts)) return message;
    let changed = false;
    const parts: UIMessage["parts"] = [];
    for (const part of message.parts) {
      if (
        !part ||
        typeof part !== "object" ||
        !(isToolPart(part) || part.type === "dynamic-tool")
      ) {
        parts.push(part);
        continue;
      }
      const repaired = repairToolPart(part, reason);
      if (repaired !== part) changed = true;
      if (repaired) parts.push(repaired);
    }
    return changed ? { ...message, parts } : message;
  });
}

/**
 * Validate a stored/client transcript, repairing interrupted tool parts first
 * and dropping only the messages that still fail. A single unusable message
 * must never block the whole channel — the user could not send anything else
 * until the poisoned history aged out of the window.
 */
export async function validateResumableUIMessages(messages: unknown[]): Promise<UIMessage[]> {
  const repaired = repairInterruptedToolParts(messages as UIMessage[]);
  try {
    return await validateUIMessages({ messages: repaired });
  } catch (err) {
    console.warn(
      "[chat] transcript failed validation; dropping unusable messages",
      err instanceof Error ? err.message : err,
    );
  }
  const kept: UIMessage[] = [];
  for (const message of repaired) {
    try {
      kept.push(...(await validateUIMessages({ messages: [message] })));
    } catch {
      // Unrepairable message — keep the rest of the conversation.
    }
  }
  return kept;
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
 * OpenAI `itemId`s on remaining parts are stripped for the same reason — see
 * `stripOpenAIItemIds`.
 *
 * Also JSON-clones completed tool outputs so Prisma Date fields never reach
 * the AI SDK prompt validator (AI_InvalidPromptError / expected string, got Date).
 */
export function sanitizeUiMessagesForModel(messages: UIMessage[]): UIMessage[] {
  const seen = new Set<string>();
  return repairInterruptedToolParts(messages)
    .filter((message) => {
      // Client reconnects can append the same message id twice.
      if (!message.id) return true;
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    })
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
          const withoutIds = stripOpenAIItemIds(part);
          if (!isToolUIPart(withoutIds)) return withoutIds;
          if (!("output" in withoutIds) || withoutIds.output === undefined) {
            return withoutIds;
          }
          try {
            return { ...withoutIds, output: jsonSafe(withoutIds.output) };
          } catch {
            return withoutIds;
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

/**
 * The mirror of `stripOrphanToolCalls`: a tool-result whose call is gone (a
 * truncated history window, a dropped assistant turn) is just as invalid as a
 * call with no result.
 */
export function stripOrphanToolResults(messages: ModelMessage[]): ModelMessage[] {
  const callIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        (part.type === "tool-call" || part.type === "tool-approval-request") &&
        "toolCallId" in part &&
        typeof part.toolCallId === "string"
      ) {
        callIds.add(part.toolCallId);
      }
    }
  }

  return messages
    .map((message) => {
      if (message.role !== "tool" || !Array.isArray(message.content)) return message;
      const content = message.content.filter((part) => {
        if (typeof part !== "object" || part === null || !("toolCallId" in part)) return true;
        return typeof part.toolCallId === "string" && callIds.has(part.toolCallId);
      });
      return { ...message, content };
    })
    .filter((message) => {
      if (!Array.isArray(message.content)) return true;
      return message.content.length > 0;
    }) as ModelMessage[];
}

/** Both orphan directions, in the order a converted transcript needs them. */
export function pairToolCallsWithResults(messages: ModelMessage[]): ModelMessage[] {
  return stripOrphanToolResults(stripOrphanToolCalls(messages));
}

/** Drop empty assistant placeholders left behind by successful/aborted runs. */
export function pruneEmptyAssistantMessages(messages: UIMessage[]): UIMessage[] {
  let changed = false;
  const next = messages.filter((message) => {
    if (message.role !== "assistant") return true;
    const keep = message.parts.some((part) => {
      if (part.type === "text") return part.text.trim().length > 0;
      if (isToolPart(part)) return true;
      return false;
    });
    if (!keep) changed = true;
    return keep;
  });
  // Same reference when nothing was removed — avoids chat re-render flashes.
  return changed ? next : messages;
}

/** Marker prefix for failed assistant turns — kept in the transcript, styled in UI. */
export const ASSISTANT_FAILURE_PREFIX = "Failed: ";

export function isAssistantFailureText(text: string): boolean {
  return text.startsWith(ASSISTANT_FAILURE_PREFIX);
}

/** Mid-flight tool states left hanging when a run dies mid-tool. */
const INCOMPLETE_TOOL_STATES = new Set([
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
]);

/**
 * Keep the last assistant turn on failure and stamp a visible failure note
 * instead of deleting the empty "Working…" placeholder. Also flip in-flight
 * tool cards to output-error so they stop spinning forever.
 *
 * If the transcript ends on a user turn with no assistant reply yet (stream
 * died before the model spoke, or the client dropped the assistant bubble),
 * append a synthetic failed assistant message so the user's text stays paired
 * with a visible error instead of looking like it vanished.
 */
export function markFailedAssistantMessages(messages: UIMessage[], reason?: string): UIMessage[] {
  const detail = (reason ?? "request failed").trim() || "request failed";
  const label = `${ASSISTANT_FAILURE_PREFIX}${detail}`;

  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx < 0) {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") return messages;
    return [
      ...messages,
      {
        id: `fail_${last.id}`,
        role: "assistant",
        parts: [{ type: "text", text: label }],
      } as UIMessage,
    ];
  }

  // User sent another turn after the last assistant — failure belongs to that
  // unanswered user message, not the previous assistant.
  const trailingUser = messages.slice(lastAssistantIdx + 1).some((m) => m.role === "user");
  if (trailingUser) {
    const last = messages[messages.length - 1]!;
    return [
      ...messages,
      {
        id: `fail_${last.id}`,
        role: "assistant",
        parts: [{ type: "text", text: label }],
      } as UIMessage,
    ];
  }

  return messages.map((message, i) => {
    if (i !== lastAssistantIdx) return message;
    const alreadyFailed = message.parts.some(
      (part) => part.type === "text" && isAssistantFailureText(part.text),
    );

    let toolsUpdated = false;
    const parts: UIMessage["parts"] = message.parts.map((part) => {
      if (!isToolUIPart(part)) return part;
      if (!INCOMPLETE_TOOL_STATES.has(part.state)) return part;
      toolsUpdated = true;
      return {
        ...part,
        state: "output-error",
        errorText: detail,
      } as UIMessage["parts"][number];
    });

    if (alreadyFailed) {
      return toolsUpdated ? { ...message, parts } : message;
    }

    const hasContent = parts.some((part) => {
      if (part.type === "text") return part.text.trim().length > 0;
      if (isToolPart(part)) return true;
      return false;
    });

    if (!hasContent) {
      return { ...message, parts: [{ type: "text", text: label }] };
    }
    return {
      ...message,
      parts: [...parts, { type: "text", text: label }],
    };
  });
}

/** Plain text body of a UI message (concatenated text parts). */
export function messagePlainText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<UIMessage["parts"][number], { type: "text" }> => p.type === "text")
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join("\n");
}

/** Merge server history with a local snapshot so a failed client never drops sent user turns. */
export function mergeTranscriptPreferringUserTurns(
  server: UIMessage[],
  local: UIMessage[],
): UIMessage[] {
  const byId = new Map<string, UIMessage>();
  for (const message of server) {
    if (message.id) byId.set(message.id, message);
  }
  for (const message of local) {
    if (!message.id) continue;
    const prev = byId.get(message.id);
    if (!prev) {
      byId.set(message.id, message);
      continue;
    }
    // Prefer the richer body; never let an empty local stub wipe a stored user turn.
    const prevScore =
      prev.parts.length +
      prev.parts.reduce((n, p) => n + (p.type === "text" ? p.text.length : 10), 0);
    const nextScore =
      message.parts.length +
      message.parts.reduce((n, p) => n + (p.type === "text" ? p.text.length : 10), 0);
    if (nextScore > prevScore) byId.set(message.id, message);
  }

  const serverIds = new Set(server.map((m) => m.id).filter(Boolean));
  // Same user text may get a new client id after a failed POST — don't double-append.
  const serverUserTexts = new Set(
    server
      .filter((m) => m.role === "user")
      .map(messagePlainText)
      .filter(Boolean),
  );
  const extras = local.filter((m) => {
    if (!m.id || serverIds.has(m.id)) return false;
    if (m.role === "user") {
      const text = messagePlainText(m);
      if (text && serverUserTexts.has(text)) return false;
    }
    return true;
  });
  // Keep server order, then any local-only messages (optimistic user turns not yet loaded).
  return [...server.map((m) => byId.get(m.id) ?? m), ...extras];
}
