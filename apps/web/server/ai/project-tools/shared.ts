/**
 * Helpers, schemas and per-run state shared by more than one group of copilot
 * tools. A declaration lives here only when two or more groups use it; one
 * used by a single group lives in that group's module.
 */

import { createLogger } from "@foundry/observability";
import type { Capability, Stage } from "@foundry/domain";
import { parseKclModuleImports, parseForeignImports } from "@/lib/cad/engine";
import { requireProjectCapability } from "../../access";
import { ensureStageStarted, markDownstreamStale } from "../../stage-state";
import { getCad } from "../../cad";
import type { CadProgressUpdate } from "../../chat-run/cad-progress";
import type { CadDraftUpdate } from "../../chat-run/cad-draft";
import {
  CAD_PROGRESS_LOG_MAX,
  trimNote,
  type CadProgressLogEntry,
  type CadProgressPhase,
} from "@/lib/copilot/cad-progress";

export type ToolContext = {
  userId: string;
  projectId: string;
  branchId: string;
  /** The worker-owned editing lease; never supplied by model input. */
  runId?: string;
  /** Origin of the running app (e.g. http://localhost:3000) for render tools. */
  origin: string;
  /** Live phase/narration for CAD tools that run for minutes. */
  onCadProgress?: (update: CadProgressUpdate) => void;
  /** Called once a CAD tool call is over, so the emitter can forget it. */
  onCadProgressEnd?: (toolCallId: string) => void;
  /** Stream incomplete Python CAD source so the editor can preview it. */
  onCadDraft?: (draft: CadDraftUpdate) => void;
  /**
   * Set by any tool that changes project content, and read once by the chat
   * run when the turn ends.
   *
   * A single turn routinely touches a dozen artifacts, and re-deriving the
   * graph after each one would add seconds to the reply for a result nobody
   * looks at until the turn is over. So the tools mark the project dirty and
   * the run flushes once. There is deliberately no tool the model must
   * remember to call.
   */
  graphDirty?: { current: boolean };
};

/** AI SDK prompt schemas reject Date; Prisma rows include createdAt/updatedAt. */
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function summarizeForLog(value: unknown, max = 240): string {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text) return "∅";
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return String(value);
  }
}

function isExecutableTool(
  tool: unknown,
): tool is { execute: (...args: unknown[]) => unknown } & Record<string, unknown> {
  return (
    typeof tool === "object" &&
    tool !== null &&
    typeof (tool as { execute?: unknown }).execute === "function"
  );
}

/** Log every tool start/finish/error so worker stalls are visible in the terminal. */

export function withToolLogging<T extends Record<string, unknown>>(
  tools: T,
  meta?: { runId?: string },
): T {
  const log = createLogger("tool", meta?.runId ? { runId: meta.runId } : {});

  const wrapped: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!isExecutableTool(tool)) {
      wrapped[name] = tool;
      continue;
    }
    const execute = tool.execute.bind(tool) as (...args: unknown[]) => unknown;
    wrapped[name] = {
      ...tool,
      execute: async (...args: unknown[]) => {
        const started = Date.now();
        log.debug("tool started", { tool: name, input: summarizeForLog(args[0]) });
        try {
          const result = await execute(...args);
          const ms = Date.now() - started;
          const softError =
            result &&
            typeof result === "object" &&
            "error" in result &&
            typeof (result as { error: unknown }).error === "string"
              ? (result as { error: string }).error
              : null;
          if (softError) {
            // Returned to the model to recover from, so not an incident.
            log.warn("tool returned an error", { tool: name, ms, reason: softError });
          } else {
            log.info("tool finished", { tool: name, ms, output: summarizeForLog(result) });
          }
          return result;
        } catch (err) {
          log.error("tool threw", { tool: name, ms: Date.now() - started, err });
          throw err;
        }
      },
    };
  }
  return wrapped as T;
}

export async function guard<T>(
  ctx: ToolContext,
  capability: Capability,
  fn: (workspaceId: string) => Promise<T>,
): Promise<T | { error: string }> {
  try {
    const { project } = await requireProjectCapability(ctx.userId, ctx.projectId, capability);
    return jsonSafe(await fn(project.workspaceId));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Operation failed" };
  }
}

export async function touchStage(ctx: ToolContext, workspaceId: string, stage: Stage) {
  await ensureStageStarted({
    workspaceId,
    projectId: ctx.projectId,
    branchId: ctx.branchId,
    stage,
    actorId: ctx.userId,
  });
  const flagged = await markDownstreamStale({
    workspaceId,
    projectId: ctx.projectId,
    branchId: ctx.branchId,
    changedStage: stage,
    actorId: ctx.userId,
  });
  // Deferred rather than synced here — see ToolContext.graphDirty.
  if (ctx.graphDirty) ctx.graphDirty.current = true;
  return flagged;
}

/**
 * Per-run state shared by the CAD and render tools: the progress timeline a
 * long tool narrates into, and the real-engine check of a part script. Built
 * once per `buildProjectTools` call so every group writes to the same log.
 */
export function createToolKit(ctx: ToolContext) {
  /**
   * Generation attempts per part in text_to_cad: the first try plus one
   * self-heal retry that feeds the engine error back into the prompt.
   */
  const CAD_PART_MAX_ATTEMPTS = 2;

  /**
   * Report what a multi-minute CAD tool is doing right now, and record it in
   * a per-call timeline that long CAD tools persist on their output
   * (`progressLog`) so the transcript can replay it after the run.
   */
  const progressLogs = new Map<string, CadProgressLogEntry[]>();
  const progress = (toolCallId: string, phase: CadProgressPhase, note?: string) => {
    ctx.onCadProgress?.({ toolCallId, phase, ...(note ? { note } : {}) });
    const trimmed = note?.trim() ? trimNote(note) : undefined;
    const log = progressLogs.get(toolCallId) ?? [];
    const last = log[log.length - 1];
    if (last && last.phase === phase && last.note === trimmed) return;
    log.push({ at: Date.now(), phase, ...(trimmed ? { note: trimmed } : {}) });
    if (log.length > CAD_PROGRESS_LOG_MAX) log.splice(0, log.length - CAD_PROGRESS_LOG_MAX);
    progressLogs.set(toolCallId, log);
  };
  /** Detach the recorded timeline for inclusion in a tool's final output. */
  const takeProgressLog = (toolCallId: string): CadProgressLogEntry[] | undefined => {
    const log = progressLogs.get(toolCallId);
    progressLogs.delete(toolCallId);
    return log?.length ? log : undefined;
  };

  /**
   * Best-effort real-engine check of one part script (Zoo MCP execute_kcl).
   * Scripts that import other files need the whole project, so they stay
   * UNVERIFIED here — assembly execution covers them.
   */
  const verifyPartScript = async (
    script: string,
  ): Promise<
    | { verified: true }
    | { verified: false; executeError: string }
    | { verified: "UNVERIFIED"; reason: string }
  > => {
    if (parseKclModuleImports(script).length > 0 || parseForeignImports(script).length > 0) {
      return { verified: "UNVERIFIED", reason: "imports need the full project" };
    }
    let cad;
    try {
      cad = getCad();
    } catch (err) {
      return { verified: "UNVERIFIED", reason: err instanceof Error ? err.message : String(err) };
    }
    const verdict = await cad.executeKcl({ code: script });
    return verdict.ok ? { verified: true } : { verified: false, executeError: verdict.error };
  };

  return { CAD_PART_MAX_ATTEMPTS, progress, takeProgressLog, verifyPartScript };
}

export type ToolKit = ReturnType<typeof createToolKit>;
