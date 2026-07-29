import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { getServerEnv } from "@foundry/config";
import { mentionsAi } from "@/lib/copilot/mentions";
import type { UIMessage } from "ai";

const triageSchema = z.object({
  suggestPing: z
    .boolean()
    .describe("True when the user likely wanted the AI copilot but did not @AI"),
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
 * Light scan: message looks AI-related but has no @AI.
 * We do NOT start a run — just nudge the user to ping @AI.
 */
export async function shouldSuggestAiPing(text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed || mentionsAi(trimmed)) return false;

  const env = getServerEnv();
  if (!env.OPENAI_API_KEY) return heuristicSuggestPing(trimmed);

  try {
    const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
    const { object } = await generateObject({
      model: openai(env.AI_LIGHT_MODEL),
      schema: triageSchema,
      prompt: `You triage chat in FOUNDRY, a hardware product design workspace.
The AI copilot ONLY runs when someone writes @AI. Your job is NOT to answer —
decide if we should nudge the user to ping @AI.

suggestPing=true when the message looks like they wanted help from the AI:
- questions, requests, design/engineering asks
- "can you…", "fix…", "update the BOM", CAD/PCB/brief work
- continuing an AI task without @AI

suggestPing=false when:
- teammate notes, status updates, FYI
- acknowledgments (ok, thanks, lol, +1)
- pasted content with no ask
- clearly human-to-human chatter

User message:
"""
${trimmed.slice(0, 2000)}
"""`,
    });
    return object.suggestPing;
  } catch (error) {
    console.warn("AI ping triage failed; using heuristic:", error);
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
