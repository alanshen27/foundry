import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  validateUIMessages,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { buildProjectTools, withToolLogging } from "@/server/ai/tools";
import { appOrigin } from "@/server/app-origin";
import { COPILOT_SYSTEM_PROMPT } from "./prompt";
import {
  checkpointRunMessages,
  persistFailedRunFromEvents,
  persistRunMessages,
  type ChannelScope,
} from "./persist";
import { maxRunEventSeq, publishRunChunk, publishRunFinished, publishRunStarted } from "./publish";
import {
  markFailedAssistantMessages,
  sanitizeUiMessagesForModel,
  stripAllToolParts,
  stripOrphanToolCalls,
  stripProviderExecutedToolParts,
} from "./sanitize-messages";

function isMissingToolResultsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  const message = err instanceof Error ? err.message : String(err);
  return (
    name.includes("MissingToolResults") ||
    message.includes("Tool result is missing") ||
    message.includes("AI_MissingToolResultsError")
  );
}

function isInvalidPromptError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  const message = err instanceof Error ? err.message : String(err);
  return (
    name.includes("InvalidPrompt") ||
    name.includes("TypeValidation") ||
    message.includes("AI_InvalidPromptError") ||
    message.includes("AI_TypeValidationError") ||
    message.includes("expected string, received Date")
  );
}

/**
 * OpenAI 404 for an `item_reference` we replayed from history — the response
 * that produced the item was cancelled, expired, or never stored.
 */
function isMissingProviderItemError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = err instanceof Error ? err.message : String(err);
  return /Item with id '[^']+' not found/i.test(message);
}

/** OpenAI 400 when the same `msg_` / `fc_` / `ws_` id appears twice in input. */
function isDuplicateProviderItemError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = err instanceof Error ? err.message : String(err);
  return /Duplicate item found with id/i.test(message);
}

async function toModelMessages(
  uiMessages: UIMessage[],

  tools: any,
): Promise<{ ui: UIMessage[]; model: ModelMessage[] }> {
  const sanitized = sanitizeUiMessagesForModel(uiMessages);
  try {
    const model = stripOrphanToolCalls(
      await convertToModelMessages(sanitized, {
        tools,
        ignoreIncompleteToolCalls: true,
      }),
    );
    return { ui: sanitized, model };
  } catch (err) {
    if (!isMissingToolResultsError(err) && !isInvalidPromptError(err)) throw err;
    console.warn(
      "[chat-run] tool history poisoned; retrying without tool parts",
      err instanceof Error ? err.message : err,
    );
    const stripped = stripAllToolParts(sanitized);
    const model = stripOrphanToolCalls(
      await convertToModelMessages(stripped, {
        tools,
        ignoreIncompleteToolCalls: true,
      }),
    );
    return { ui: stripped, model };
  }
}

/** Execute one queued copilot run (called by the background worker). */
export async function executeChatRun(runId: string): Promise<void> {
  const run = await prisma.chatRun.findUnique({ where: { id: runId } });
  if (!run || run.status === "DONE" || run.status === "ERROR" || run.status === "CANCELLED") return;

  const channelId = run.channelId;

  // Claim PENDING, or take over RUNNING after a deploy/stall redelivery.
  // BullMQ only gives the job to one worker; reclaim only re-enqueues (never
  // execute). Skipping RUNNING left orphaned runs that never streamed again.
  const claimed = await prisma.chatRun.updateMany({
    where: { id: runId, status: { in: ["PENDING", "RUNNING"] } },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (claimed.count === 0) {
    const current = await prisma.chatRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    console.warn(
      `[chat-run ${runId}] skip execute — status=${current?.status ?? "missing"} (terminal)`,
    );
    return;
  }

  const scope: ChannelScope = {
    projectId: run.projectId,
    branchId: run.branchId,
    channelId,
  };

  const env = getServerEnv();
  if (!env.OPENAI_API_KEY) {
    const error = "OPENAI_API_KEY is not configured";
    await prisma.chatRun.update({
      where: { id: runId },
      data: { status: "ERROR", error, finishedAt: new Date() },
    });
    await publishRunFinished(runId, channelId, "error", error);
    return;
  }

  const rawMessages = await validateUIMessages({
    messages: run.inputMessages as unknown[],
  });

  await publishRunStarted(runId, channelId);

  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

  const tools: any = withToolLogging(
    {
      ...buildProjectTools({
        userId: run.actorId,
        projectId: run.projectId,
        branchId: run.branchId,
        origin: appOrigin(),
      }),
      web_search: openai.tools.webSearch({}),
    },
    { runId },
  );

  // Continue past any chunks a previous crashed attempt already wrote.
  let seq = await maxRunEventSeq(runId);
  let finalized = false;
  /** Latest UI transcript observed from the stream (updated in onEnd). */
  let latestMessages: UIMessage[] = rawMessages;
  let sawStreamMessages = false;
  const abort = new AbortController();

  const { copilotBroadcastChannel, createSupabaseBroadcastPort, createOffBroadcastPort } =
    await import("@foundry/realtime");
  let port;
  if (
    env.NEXT_PUBLIC_REALTIME_MODE === "supabase" &&
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    port = createSupabaseBroadcastPort({
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  } else {
    port = createOffBroadcastPort();
  }

  const cancelSub = port.subscribe(copilotBroadcastChannel(channelId), (msg) => {
    const payload = msg.payload as { runId: string; status?: string };
    if (msg.event === "run-finished" && payload.runId === runId && payload.status === "cancelled") {
      if (!abort.signal.aborted) abort.abort();
    }
  });

  async function finalize(status: "done" | "error" | "cancelled", error?: string): Promise<void> {
    if (finalized) return;
    finalized = true;

    let messages = latestMessages;
    // If the stream died before onEnd, rebuild whatever chunks we already
    // published so the user still has the assistant turn after refresh.
    if (status !== "done" && !sawStreamMessages) {
      try {
        const { rebuildUiMessagesFromRunEvents } = await import("./persist");
        messages = await rebuildUiMessagesFromRunEvents(runId, rawMessages);
      } catch (err) {
        console.error(`[chat-run ${runId}] rebuild before finalize failed`, err);
      }
    }

    if (status === "error") {
      messages = markFailedAssistantMessages(messages, error ?? "request failed");
    } else if (status === "cancelled") {
      // Keep partial work; only stamp if the assistant turn would otherwise
      // look empty after prune on the client.
      const hasAssistantContent = messages.some(
        (m) =>
          m.role === "assistant" &&
          m.parts.some((p) => {
            if (p.type === "text") return p.text.trim().length > 0;
            return p.type.startsWith("tool-") || p.type === "dynamic-tool";
          }),
      );
      if (!hasAssistantContent) {
        messages = markFailedAssistantMessages(messages, "cancelled");
      }
    }

    await persistRunMessages(scope, messages).catch((err) => {
      console.error(`[chat-run ${runId}] failed to persist messages`, err);
    });

    await prisma.chatRun.update({
      where: { id: runId },
      data: {
        status: status === "done" ? "DONE" : status === "cancelled" ? "CANCELLED" : "ERROR",
        finishedAt: new Date(),
        error: status === "done" ? null : (error ?? status),
      },
    });
    await publishRunFinished(
      runId,
      channelId,
      status,
      status === "error"
        ? (error ?? "request failed")
        : status === "cancelled"
          ? "cancelled"
          : null,
    );
  }

  try {
    let prepared = await toModelMessages(rawMessages, tools);

    const runStream = async (uiMessages: UIMessage[], modelMessages: ModelMessage[]) => {
      const result = streamText({
        model: openai(env.AI_MODEL),
        system: COPILOT_SYSTEM_PROMPT,
        messages: modelMessages,
        tools,
        abortSignal: abort.signal,
        stopWhen: stepCountIs(14),
        onStepFinish: ({ toolCalls, toolResults, finishReason }) => {
          if (toolCalls.length === 0 && toolResults.length === 0) {
            console.log(`[chat-run ${runId}] step finish reason=${finishReason} (no tools)`);
            return;
          }
          console.log(
            `[chat-run ${runId}] step finish reason=${finishReason} tools=${toolCalls
              .map((c) => c.toolName)
              .join(",")}`,
          );
          for (const call of toolCalls) {
            console.log(
              `[chat-run ${runId}] tool-call ${call.toolName}`,
              typeof call.input === "string"
                ? call.input.slice(0, 200)
                : JSON.stringify(call.input)?.slice(0, 200),
            );
          }
          for (const tr of toolResults) {
            console.log(
              `[chat-run ${runId}] tool-result ${tr.toolName}`,
              typeof tr.output === "string"
                ? tr.output.slice(0, 200)
                : JSON.stringify(tr.output)?.slice(0, 200),
            );
          }
        },
      });

      const uiStream = result.toUIMessageStream({
        originalMessages: uiMessages,
        onEnd: async ({ messages: finalMessages }) => {
          latestMessages = finalMessages as UIMessage[];
          sawStreamMessages = true;
        },
      });

      const reader = uiStream.getReader();
      let lastCheckpointAt = 0;
      let checkpointing: Promise<void> | null = null;
      const maybeCheckpoint = (force = false) => {
        const now = Date.now();
        if (!force && now - lastCheckpointAt < 1_200) return;
        if (checkpointing) return;
        lastCheckpointAt = now;
        checkpointing = checkpointRunMessages({
          runId,
          scope,
          inputMessages: uiMessages,
        })
          .then((rebuilt) => {
            latestMessages = rebuilt;
            sawStreamMessages = true;
          })
          .catch((err) => {
            console.warn(`[chat-run ${runId}] stream checkpoint failed`, err);
          })
          .finally(() => {
            checkpointing = null;
          });
      };

      try {
        while (true) {
          if (abort.signal.aborted) {
            await reader.cancel().catch(() => undefined);
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          await publishRunChunk(runId, channelId, ++seq, value);
          const kind = value && typeof value === "object" && "type" in value ? value.type : "";
          // Persist often enough that a reload mid-Zoo-tool still has text +
          // tool cards; force on step boundaries.
          maybeCheckpoint(
            kind === "finish-step" ||
              kind === "tool-output-available" ||
              kind === "tool-output-error" ||
              kind === "text-end",
          );
        }
      } finally {
        reader.releaseLock();
        maybeCheckpoint(true);
        const pending = checkpointing;
        if (pending) await pending;
      }
    };

    try {
      await runStream(prepared.ui, prepared.model);
    } catch (err) {
      // convertToLanguageModelPrompt throws here once the stream starts.
      const missingItem = isMissingProviderItemError(err);
      const duplicateItem = isDuplicateProviderItemError(err);
      const recoverable =
        missingItem || duplicateItem || isMissingToolResultsError(err) || isInvalidPromptError(err);
      if (!recoverable || abort.signal.aborted) throw err;
      console.warn(
        duplicateItem
          ? "[chat-run] duplicate provider item id; retrying without provider-executed tool parts"
          : missingItem
            ? "[chat-run] stale provider item reference; retrying without provider-executed tool parts"
            : "[chat-run] prompt/tool history error during stream; retrying without tool parts",
        err instanceof Error ? err.message : err,
      );
      // Reasoning / itemIds are already stripped in sanitize. A missing or
      // duplicate item id after that is almost always a provider-executed tool
      // (web_search) still leaking references.
      const stripped =
        missingItem || duplicateItem
          ? stripProviderExecutedToolParts(prepared.ui)
          : stripAllToolParts(prepared.ui);
      prepared = {
        ui: stripped,
        model: stripOrphanToolCalls(
          await convertToModelMessages(stripped, {
            tools,
            ignoreIncompleteToolCalls: true,
          }),
        ),
      };
      seq = await maxRunEventSeq(runId);
      await runStream(prepared.ui, prepared.model);
    }

    if (abort.signal.aborted) {
      await finalize("cancelled", "cancelled");
    } else {
      await finalize("done");
    }
  } catch (err) {
    const cancelled = abort.signal.aborted;
    if (cancelled) {
      await finalize("cancelled", "cancelled");
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    await finalize("error", message);
    throw err;
  } finally {
    // Last-resort persist if finalize never ran (should be rare).
    if (!finalized) {
      await persistFailedRunFromEvents({
        runId,
        scope,
        inputMessages: rawMessages,
        error: "run ended without finalize",
      }).catch((err) => console.error(`[chat-run ${runId}] last-resort persist failed`, err));
    }
    cancelSub.leave();
  }
}
