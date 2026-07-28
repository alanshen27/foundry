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
import { saveNewMessages } from "./persist";
import { publishRunChunk, publishRunFinished, publishRunStarted } from "./publish";
import {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  await prisma.chatRun.update({
    where: { id: runId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  const env = getServerEnv();
  if (!env.OPENAI_API_KEY) {
    await prisma.chatRun.update({
      where: { id: runId },
      data: { status: "ERROR", error: "OPENAI_API_KEY is not configured", finishedAt: new Date() },
    });
    await publishRunFinished(runId, run.channelId, "error");
    return;
  }

  const rawMessages = await validateUIMessages({
    messages: run.inputMessages as unknown[],
  });

  await publishRunStarted(runId, run.channelId);

  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  let seq = 0;
  let finished = false;
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

  const cancelSub = port.subscribe(copilotBroadcastChannel(run.channelId), (msg) => {
    const payload = msg.payload as { runId: string; status?: string };
    if (msg.event === "run-finished" && payload.runId === runId && payload.status === "cancelled") {
      if (!abort.signal.aborted) abort.abort();
    }
  });

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
        onEnd: async ({ messages: finalMessages, isAborted }) => {
          if (finished) return;
          finished = true;

          const cancelled = isAborted || abort.signal.aborted;
          // Save even when cancelled: whatever the model produced before the
          // stop is real work the user watched happen, and dropping it is why
          // interrupted turns used to vanish on reload.
          await saveNewMessages(
            {
              projectId: run.projectId,
              branchId: run.branchId,
              channelId: run.channelId,
            },
            finalMessages as UIMessage[],
          ).catch((err) => {
            console.error(`[chat-run ${runId}] failed to persist messages`, err);
          });

          await prisma.chatRun.update({
            where: { id: runId },
            data: {
              status: cancelled ? "CANCELLED" : "DONE",
              finishedAt: new Date(),
              error: cancelled ? "cancelled" : null,
            },
          });
          await publishRunFinished(runId, run.channelId, cancelled ? "cancelled" : "done");
        },
      });

      const reader = uiStream.getReader();
      try {
        while (true) {
          if (abort.signal.aborted) {
            await reader.cancel().catch(() => undefined);
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          await publishRunChunk(runId, run.channelId, ++seq, value);
        }
      } finally {
        reader.releaseLock();
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
      seq = 0;
      await runStream(prepared.ui, prepared.model);
    }
  } catch (err) {
    const cancelled = abort.signal.aborted;
    if (cancelled) {
      if (!finished) {
        finished = true;
        await prisma.chatRun.update({
          where: { id: runId },
          data: { status: "CANCELLED", finishedAt: new Date(), error: "cancelled" },
        });
        await publishRunFinished(runId, run.channelId, "cancelled");
      }
      return;
    }
    if (!finished) {
      finished = true;
      const message = err instanceof Error ? err.message : String(err);
      await prisma.chatRun.update({
        where: { id: runId },
        data: { status: "ERROR", error: message, finishedAt: new Date() },
      });
      await publishRunFinished(runId, run.channelId, "error");
    }
    throw err;
  } finally {
    cancelSub.leave();
  }
}
