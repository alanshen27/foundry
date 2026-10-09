import { z } from "zod";
import { getServerEnv } from "@foundry/config";
import { mentionsAi } from "@/lib/copilot/mentions";
import type { UIMessage } from "ai";
import { createLogger } from "@foundry/observability";
import { sanitizeUiMessagesForModel } from "./sanitize-messages";

const log = createLogger("chat-triage");

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
/** Noul is the probability of yes. At or above this, we suggest pinging @AI. */
const JEV_YES_THRESHOLD = 0.5;
const HISTORY_CHAR_LIMIT = 12_000;

const jevAnswerSchema = z.object({
  answers: z.object({
    needs_ai: z.object({
      type: z.literal("noul"),
      noul: z.number(),
    }),
  }),
});

/** Flatten text parts from a UI message. */
export function uiMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** Latest user turn text, if any. */
export function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user") return uiMessageText(message).trim();
  }
  return "";
}

/** Latest user message id (for tip dedupe keys). */
export function lastUserMessageId(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user" && message.id) return message.id;
  }
  return null;
}

/** Full copilot run — only when the user explicitly @AI's. */
export function shouldInvokeAi(text: string): boolean {
  return Boolean(text.trim()) && mentionsAi(text);
}

/** Cheap heuristic when the light model is unavailable. */
function heuristicSuggestPing(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (mentionsAi(trimmed)) return false;
  if (/[?]/.test(trimmed)) return true;
  if (
    /^(please|pls|can you|could you|would you|help|fix|update|add|create|make|build|design|change|set|run|check|explain|what|how|why|where|when)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (/^(ok|okay|k|thanks|thank you|ty|np|lol|lgtm|\+1|done|noted|fyi)\b/i.test(trimmed)) {
    return false;
  }
  return false;
}

/**
 * User and assistant text only, after dropping incomplete tools and reasoning.
 * Jev sees this transcript, not raw tool payloads.
 */
export function cleanedChatHistory(messages: UIMessage[]): string {
  const lines: string[] = [];
  for (const message of sanitizeUiMessagesForModel(messages)) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = uiMessageText(message).trim();
    if (!text) continue;
    lines.push(`${message.role}: ${text}`);
  }
  return lines.join("\n\n").slice(-HISTORY_CHAR_LIMIT);
}

/**
 * Light scan: the conversation looks like it wanted the copilot, but nobody wrote @AI.
 * We do NOT start a run — just nudge the user to ping @AI.
 * Jev returns a yes-probability; true means that probability is at least 0.5.
 */
export async function shouldSuggestAiPing(messages: UIMessage[]): Promise<boolean> {
  const trimmed = lastUserText(messages);
  if (!trimmed || mentionsAi(trimmed)) return false;

  const history = cleanedChatHistory(messages);
  const env = getServerEnv();
  if (!env.OPENROUTER_API_KEY || !history) return heuristicSuggestPing(trimmed);

  try {
    const response = await fetch(DECISIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.JEV_MODEL,
        state: { chat: history },
        questions: {
          needs_ai: {
            type: "noul",
            instructions:
              "Does the latest user message ask the FOUNDRY AI copilot for help, even though nobody wrote @AI? Judge that message in the context of the earlier chat.",
            criteria: {
              true: "A question or request about the product, design, CAD, PCB, BOM, firmware, or continuing an AI task.",
              false:
                "Teammate notes, status, thanks, acknowledgements, pasted content with no ask, or human-to-human chatter.",
            },
          },
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      log.warn("ping triage rejected; using heuristic", { status: response.status });
      return heuristicSuggestPing(trimmed);
    }
    const parsed = jevAnswerSchema.safeParse(await response.json());
    if (!parsed.success) {
      log.warn("ping triage returned an unexpected shape; using heuristic");
      return heuristicSuggestPing(trimmed);
    }
    return parsed.data.answers.needs_ai.noul >= JEV_YES_THRESHOLD;
  } catch (error) {
    log.warn("ping triage failed; using heuristic", { err: error });
    return heuristicSuggestPing(trimmed);
  }
}

const PING_TIPS = [
  "You probably wanna ping @AI for that.",
  "Sounds like a job for @AI — mention them if you want a hand.",
  "Might want to @AI that one if you're asking the copilot.",
];

/** Casual in-channel tip (assistant message, not a full agent run). */
export function buildAiPingTip(userMessageId: string): UIMessage {
  const text = PING_TIPS[Math.floor(Math.random() * PING_TIPS.length)]!;
  return {
    id: `ai-ping-tip-${userMessageId}`,
    role: "assistant",
    parts: [{ type: "text", text }],
  };
}
