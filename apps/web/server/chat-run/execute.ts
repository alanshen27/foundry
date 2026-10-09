import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type ModelMessage,
  type UIMessage,
  type ToolSet,
  type UIMessageChunk,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { buildProjectTools, withToolLogging } from "@/server/ai/tools";
import { buildGraphTools } from "@/server/ai/graph-tools";
import { addStepUsage, emptyUsage, recordRunUsage } from "@/server/ai-usage";
import { createLogger } from "@foundry/observability";
import { appOrigin } from "@/server/app-origin";
import { COPILOT_SYSTEM_PROMPT, MAX_RUN_STEPS, finalStepSettings } from "./prompt";
import {
  checkpointRunMessages,
  persistFailedRunFromEvents,
  persistRunMessages,
  type ChannelScope,
} from "./persist";
import { createCadProgressEmitter } from "./cad-progress";
import { createCadDraftEmitter } from "./cad-draft";
import { withLiveToolDrafts } from "./tool-draft";
import { maxRunEventSeq, publishRunChunks, publishRunFinished, publishRunStarted } from "./publish";
import { createRunEventWriter, isPublishedRunChunk } from "./event-writer";
import {
  markFailedAssistantMessages,
  markCancelledAssistantMessages,
  compactHistoryForModel,
  pairToolCallsWithResults,
  sanitizeUiMessagesForModel,
  stripAllToolParts,
  stripProviderExecutedToolParts,
  validateResumableUIMessages,
} from "./sanitize-messages";

const log = createLogger("chat-run");

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

/** A provider tool's original reasoning was dropped while replaying old history. */
function isMissingProviderReasoningError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /(?:without|missing).*required.*reasoning.*item|reasoning.*item.*required/i.test(message);
}

function isContextLengthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /context window|context length|maximum context|too many tokens|input exceeds/i.test(
    message,
  );
}

/** OpenAI 400 when the same `msg_` / `fc_` / `ws_` id appears twice in input. */
function isDuplicateProviderItemError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = err instanceof Error ? err.message : String(err);
  return /Duplicate item found with id/i.test(message);
}

async function toModelMessages(
  uiMessages: UIMessage[],

  tools: ToolSet,
): Promise<{ ui: UIMessage[]; model: ModelMessage[] }> {
  const sanitized = compactHistoryForModel(sanitizeUiMessagesForModel(uiMessages));
  try {
    const model = pairToolCallsWithResults(
      await convertToModelMessages(sanitized, {
        tools,
        ignoreIncompleteToolCalls: true,
      }),
    );
    return { ui: sanitized, model };
  } catch (err) {
    if (!isMissingToolResultsError(err) && !isInvalidPromptError(err)) throw err;
    log.warn("tool history poisoned; retrying without tool parts", { err });
    const stripped = stripAllToolParts(sanitized);
    const model = pairToolCallsWithResults(
      await convertToModelMessages(stripped, {
        tools,
        ignoreIncompleteToolCalls: true,
      }),
    );
    return { ui: stripped, model };
  }
}

/** Worker heartbeat cadence; live attempts refresh startedAt this often. */
const HEARTBEAT_MS = 15_000;
/** A RUNNING row whose heartbeat is older than this belongs to a dead worker. */
export const HEARTBEAT_STALE_MS = 75_000;

/**
 * A redelivered job found its run already RUNNING. Never re-run the model —
 * a second attempt appends to the same event log, which duplicated tool
 * calls (and re-fired real Zoo mutations) on every deploy/stall. If the old
 * attempt is dead (stale heartbeat) fail the run visibly so the user can
 * retry; if it's still alive on another worker, leave it alone.
 */
async function failDeadRunningAttempt(
  run: { id: string; channelId: string; inputMessages: unknown },
  scope: ChannelScope,
): Promise<void> {
  const error = "The chat worker restarted while this reply was in flight. Send the message again.";
  const takeover = await prisma.chatRun.updateMany({
    where: {
      id: run.id,
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - HEARTBEAT_STALE_MS) },
    },
    data: { status: "ERROR", error, finishedAt: new Date() },
  });
  if (takeover.count === 0) {
    log.warn("skip execute: live on another worker or already terminal", { runId: run.id });
    return;
  }
  log.warn("dead RUNNING attempt failed cleanly (not re-run)", { runId: run.id });
  let inputMessages: UIMessage[] = [];
  try {
    inputMessages = await validateResumableUIMessages(run.inputMessages as unknown[]);
  } catch {
    // Unparseable history — persist from events alone.
  }
  await persistFailedRunFromEvents({ runId: run.id, scope, inputMessages, error }).catch((err) =>
    log.error("takeover persist failed", { runId: run.id, err }),
  );
  await publishRunFinished(run.id, run.channelId, "error", error);
}

/** Execute one queued copilot run (called by the background worker). */
export async function executeChatRun(runId: string): Promise<void> {
  const run = await prisma.chatRun.findUnique({ where: { id: runId } });
  if (!run || run.status === "DONE" || run.status === "ERROR" || run.status === "CANCELLED") return;

  const channelId = run.channelId;
  const scope: ChannelScope = {
    projectId: run.projectId,
    branchId: run.branchId,
    channelId,
  };

  // Claim strictly PENDING → RUNNING. A RUNNING row means another attempt
  // owns (or owned) this run; failDeadRunningAttempt decides via heartbeat.
  const claimed = await prisma.chatRun.updateMany({
    where: { id: runId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (claimed.count === 0) {
    await failDeadRunningAttempt(run, scope);
    return;
  }

  try {
    await executeClaimedChatRun(run);
  } catch (err) {
    // Setup/validation can fail before the stream's own finalizer exists.
    // Never leave a claimed run RUNNING because of malformed old history.
    const error = err instanceof Error ? err.message : String(err);
    const failed = await prisma.chatRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: { status: "ERROR", error, finishedAt: new Date() },
    });
    if (failed.count > 0) {
      let inputMessages: UIMessage[] = [];
      try {
        inputMessages = await validateResumableUIMessages(run.inputMessages as unknown[]);
      } catch {
        /* Recover from persisted events when the input itself is invalid. */
      }
      await persistFailedRunFromEvents({ runId, scope, inputMessages, error }).catch((cause) =>
        console.error(`[chat-run ${runId}] setup failure persist failed`, cause),
      );
      await publishRunFinished(runId, channelId, "error", error);
    }
    throw err;
  }
}

async function executeClaimedChatRun(
  run: NonNullable<Awaited<ReturnType<typeof prisma.chatRun.findUnique>>>,
) {
  const runId = run.id;
  const channelId = run.channelId;
  const runLog = log.child({ runId, projectId: run.projectId });
  const scope: ChannelScope = { projectId: run.projectId, branchId: run.branchId, channelId };
  const env = getServerEnv();
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const rawMessages = await validateResumableUIMessages(run.inputMessages as unknown[]);

  await publishRunStarted(runId, channelId);

  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

  // Continue past any chunks a previous crashed attempt already wrote.
  const seq = await maxRunEventSeq(runId);

  // One ordered queue for model, source drafts and progress. Otherwise a
  // later model event can arrive first and advance SSE past an unseen draft.
  const abort = new AbortController();
  let finalized = false;
  let persistenceFailed = false;
  let persistenceError: unknown;
  const eventWriter = createRunEventWriter({
    initialSeq: seq,
    persist: (events) => publishRunChunks(runId, events),
    onError: (error) => {
      persistenceFailed = true;
      persistenceError = error;
      abort.abort(error);
    },
  });
  const enqueueChunk = eventWriter.enqueue;
  const publishProgress = (chunk: UIMessageChunk) => {
    if (abort.signal.aborted || finalized) return;
    void enqueueChunk(chunk).catch(() => undefined);
  };
  const cadProgress = createCadProgressEmitter(publishProgress);
  const cadDraft = createCadDraftEmitter(publishProgress);

  // Set by any tool that changes project content; flushed once in finalize.
  const graphDirty = { current: false };
  // Summed per step so a failed or cancelled run still records what it spent.
  let usage = emptyUsage();

  const tools = withToolLogging(
    {
      ...withLiveToolDrafts(
        buildProjectTools({
          runId,
          userId: run.actorId,
          projectId: run.projectId,
          branchId: run.branchId,
          origin: appOrigin(),
          onCadProgress: cadProgress.emit,
          onCadProgressEnd: (toolCallId) => {
            cadProgress.end(toolCallId);
            cadDraft.end(toolCallId);
          },
          onCadDraft: cadDraft.emit,
          graphDirty,
        }),
        cadDraft,
      ),
      ...buildGraphTools({
        userId: run.actorId,
        projectId: run.projectId,
        branchId: run.branchId,
      }),
      web_search: openai.tools.webSearch({}),
    },
    { runId },
  );

  /** Latest UI transcript observed from the stream (updated in onEnd). */
  let latestMessages: UIMessage[] = rawMessages;

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

  // Heartbeat startedAt so redelivered jobs can tell a live attempt from a
  // dead one. Doubles as a cancellation poll: if cancel/stale terminalized
  // the row out from under us, stop streaming instead of racing finalize.
  const heartbeat = setInterval(() => {
    void prisma.chatRun
      .updateMany({
        where: { id: runId, status: "RUNNING" },
        data: { startedAt: new Date() },
      })
      .then((res) => {
        if (res.count === 0 && !abort.signal.aborted) abort.abort();
      })
      .catch(() => undefined);
  }, HEARTBEAT_MS);
  (heartbeat as unknown as { unref?: () => void }).unref?.();

  async function finalize(status: "done" | "error" | "cancelled", error?: string): Promise<void> {
    if (finalized) return;
    finalized = true;
    if (abort.signal.aborted) eventWriter.discardTransient();
    await eventWriter.close();
    // Lease loss also aborts this reader when another worker has already
    // failed or completed the run. Preserve that outcome, not a false Stop.
    const terminal = await prisma.chatRun.findUnique({
      where: { id: runId },
      select: { status: true, error: true },
    });
    if (terminal?.status === "ERROR") {
      status = "error";
      error = terminal.error ?? "Run failed";
    } else if (terminal?.status === "DONE") {
      status = "done";
    } else if (terminal?.status === "CANCELLED") {
      status = "cancelled";
    }

    await recordRunUsage(runId, env.AI_MODEL, usage);

    // One graph resync per turn, however many artifacts the model touched.
    // Runs even on error or cancel: whatever was written before the failure is
    // still written, and a graph that lags the database is worse than one
    // rebuilt from a half-finished turn.
    if (graphDirty.current) {
      try {
        const { syncProductGraph } = await import("@/server/graph/sync");
        // ChatRun carries no workspaceId, and the audit envelope requires one.
        const project = await prisma.project.findUnique({
          where: { id: scope.projectId },
          select: { workspaceId: true },
        });
        if (project) {
          await syncProductGraph({
            projectId: scope.projectId,
            branchId: scope.branchId,
            workspaceId: project.workspaceId,
            actorId: run.actorId,
            actorType: "AGENT",
          });
        }
      } catch (err) {
        runLog.error("graph sync failed", { err });
      }
    }

    let messages = latestMessages;
    // Rebuild the fully drained log. An in-flight checkpoint may have read
    // before the final tool chunk and must not truncate the saved turn.
    {
      try {
        const { rebuildUiMessagesFromRunEvents } = await import("./persist");
        messages = await rebuildUiMessagesFromRunEvents(runId, rawMessages);
      } catch (err) {
        runLog.error("rebuild before finalize failed", { err });
      }
    }

    if (status === "error") {
      messages = markFailedAssistantMessages(messages, error ?? "request failed");
    } else if (status === "cancelled") {
      messages = markCancelledAssistantMessages(messages);
    }

    await persistRunMessages(scope, messages).catch((err) => {
      runLog.error("failed to persist messages", { err });
    });

    // Guarded: if cancel/stale/takeover already terminalized this run, that
    // status (and its broadcast) won — don't overwrite or double-publish.
    const terminalized = await prisma.chatRun.updateMany({
      where: { id: runId, status: { in: ["PENDING", "RUNNING"] } },
      data: {
        status: status === "done" ? "DONE" : status === "cancelled" ? "CANCELLED" : "ERROR",
        finishedAt: new Date(),
        error: status === "done" ? null : (error ?? status),
      },
    });
    if (terminalized.count === 0) return;
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
    // Catch cancellation that happened during setup, before the broadcast
    // subscription existed. A stopped pending run must never start tools.
    const lease = await prisma.chatRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (lease?.status !== "RUNNING") {
      abort.abort();
      await finalize("cancelled", "cancelled");
      return;
    }
    let prepared = await toModelMessages(rawMessages, tools);

    let attemptProducedContent = false;
    const runStream = async (uiMessages: UIMessage[], modelMessages: ModelMessage[]) => {
      attemptProducedContent = false;
      let streamError: unknown;
      const result = streamText({
        model: openai(env.AI_MODEL),
        system: COPILOT_SYSTEM_PROMPT,
        messages: modelMessages,
        tools,
        abortSignal: abort.signal,
        // The SDK normally emits errors as chunks instead of rejecting the
        // reader. Keep the original error for recovery and terminal status.
        onError: ({ error }) => {
          streamError = error;
        },
        stopWhen: stepCountIs(MAX_RUN_STEPS),
        prepareStep: ({ stepNumber }) => finalStepSettings(stepNumber),
        ...(env.AI_MAX_OUTPUT_TOKENS ? { maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS } : {}),
        onStepFinish: ({ toolCalls, toolResults, finishReason, usage: stepUsage }) => {
          usage = addStepUsage(usage, stepUsage);
          runLog.info("step finished", {
            finishReason,
            step: usage.stepCount,
            tokens: stepUsage?.totalTokens,
            tools: toolCalls.map((c) => c.toolName),
          });
          // Tool arguments and results can carry prompt text and project
          // content, so they stay at debug, which production does not emit.
          for (const call of toolCalls) {
            runLog.debug("tool call", {
              tool: call.toolName,
              input:
                typeof call.input === "string"
                  ? call.input.slice(0, 200)
                  : JSON.stringify(call.input)?.slice(0, 200),
            });
          }
          for (const tr of toolResults) {
            runLog.debug("tool result", {
              tool: tr.toolName,
              output:
                typeof tr.output === "string"
                  ? tr.output.slice(0, 200)
                  : JSON.stringify(tr.output)?.slice(0, 200),
            });
          }
        },
      });

      const uiStream = result.toUIMessageStream({
        originalMessages: uiMessages,
        // The worker and every browser must persist the same assistant ID.
        // Without this the SDK emits start without messageId, and a server
        // checkpoint reconstructs an empty ID that persistence discards.
        generateMessageId: () => `assistant_${runId}`,
        onError: (error) => {
          streamError = error;
          return error instanceof Error ? error.message : String(error);
        },
        onEnd: async ({ messages: finalMessages }) => {
          latestMessages = finalMessages as UIMessage[];
        },
      });

      const reader = uiStream.getReader();
      // A slow tool may ignore abortSignal. Cancel the consumer immediately;
      // do not wait for that tool to produce its next stream chunk.
      const stopReading = () => {
        eventWriter.discardTransient();
        void reader.cancel().catch(() => undefined);
      };
      abort.signal.addEventListener("abort", stopReading, { once: true });
      let lastCheckpointAt = 0;
      let checkpointing: Promise<void> | null = null;
      const maybeCheckpoint = (force = false) => {
        const now = Date.now();
        if (!force && now - lastCheckpointAt < 1_200) return;
        if (checkpointing) return;
        lastCheckpointAt = now;
        checkpointing = eventWriter
          .flush()
          .then(() =>
            checkpointRunMessages({
              runId,
              scope,
              inputMessages: uiMessages,
            }),
          )
          .then((rebuilt) => {
            latestMessages = rebuilt;
          })
          .catch((err) => {
            runLog.warn("stream checkpoint failed", { err });
          })
          .finally(() => {
            checkpointing = null;
          });
      };

      try {
        while (true) {
          if (abort.signal.aborted) {
            stopReading();
            break;
          }
          const { done, value } = await reader.read();
          if (done || abort.signal.aborted) break;
          if (value.type === "error") {
            streamError ??= new Error(value.errorText);
            // Do not poison the client stream with a recoverable first
            // attempt error. Finalization exposes errors after recovery fails.
            continue;
          }
          if (!["start", "start-step", "finish-step", "finish"].includes(value.type)) {
            attemptProducedContent = true;
          }
          if (!isPublishedRunChunk(value)) continue;
          // Enqueue immediately; only pause consumption when the bounded
          // buffer fills. Progress must not delay completed tool results.
          await enqueueChunk(value);
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
        abort.signal.removeEventListener("abort", stopReading);
        reader.releaseLock();
        await eventWriter.flush();
        maybeCheckpoint(true);
        const pending = checkpointing;
        if (pending) await pending;
      }
      if (streamError != null && !abort.signal.aborted) throw streamError;
    };

    try {
      await runStream(rawMessages, prepared.model);
    } catch (err) {
      // A long CAD thread can still overflow after the first shorten. Retry
      // once with a tighter budget before the model has done any work.
      if (isContextLengthError(err) && !attemptProducedContent && !abort.signal.aborted) {
        runLog.warn("prompt exceeded the context window; retrying with a shorter history", {
          err,
        });
        const shortened = compactHistoryForModel(prepared.ui, {
          charBudget: 24_000,
          keepRecent: 1,
        });
        prepared = {
          ui: shortened,
          model: pairToolCallsWithResults(
            await convertToModelMessages(shortened, {
              tools,
              ignoreIncompleteToolCalls: true,
            }),
          ),
        };
        await runStream(rawMessages, prepared.model);
      } else {
        // convertToLanguageModelPrompt throws here once the stream starts.
        const missingItem = isMissingProviderItemError(err) || isMissingProviderReasoningError(err);
        const duplicateItem = isDuplicateProviderItemError(err);
        const recoverable =
          missingItem ||
          duplicateItem ||
          isMissingToolResultsError(err) ||
          isInvalidPromptError(err);
        // Never replay an attempt that has already issued tools or text; its
        // writes may have committed and replaying could duplicate real work.
        if (!recoverable || attemptProducedContent || abort.signal.aborted) throw err;
        runLog.warn(
          duplicateItem
            ? "duplicate provider item id; retrying without provider-executed tool parts"
            : missingItem
              ? "stale provider item reference; retrying without provider-executed tool parts"
              : "prompt/tool history error during stream; retrying without tool parts",
          { err },
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
          model: pairToolCallsWithResults(
            await convertToModelMessages(stripped, {
              tools,
              ignoreIncompleteToolCalls: true,
            }),
          ),
        };
        await runStream(rawMessages, prepared.model);
      }
    }

    if (persistenceFailed) throw persistenceError;
    if (abort.signal.aborted) {
      await finalize("cancelled", "cancelled");
    } else {
      await finalize("done");
    }
  } catch (err) {
    const cancelled = abort.signal.aborted && !persistenceFailed;
    if (cancelled) {
      await finalize("cancelled", "cancelled");
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    await finalize("error", message);
    throw err;
  } finally {
    clearInterval(heartbeat);
    // Last-resort terminalize + persist if finalize never ran (should be rare).
    if (!finalized) {
      await prisma.chatRun
        .updateMany({
          where: { id: runId, status: { in: ["PENDING", "RUNNING"] } },
          data: { status: "ERROR", error: "run ended without finalize", finishedAt: new Date() },
        })
        .catch(() => undefined);
      await persistFailedRunFromEvents({
        runId,
        scope,
        inputMessages: rawMessages,
        error: "run ended without finalize",
      }).catch((err) => runLog.error("last-resort persist failed", { err }));
    }
    cancelSub.leave();
  }
}
