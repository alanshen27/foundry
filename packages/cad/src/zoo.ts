import { ApiError, Client, ml, type TextToCadResponse } from "@kittycad/lib";
import type { CadPort, CadProjectIterateOptions, CadResult } from "./port";
import { ZooMcpClient } from "./mcp";
import { isPlausibleZooOpId } from "./op-id";
import { zookeeperPrompt } from "./zookeeper";

export { isPlausibleZooOpId } from "./op-id";

const POLL_MS = 2000;
/** Zoo text-to-CAD regularly exceeds 5 minutes on cold/queue; allow ~10 minutes. */
const MAX_POLLS = 300;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function asError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as
      { message?: string; error_code?: string; request_id?: string } | undefined;
    const parts = [
      body?.message,
      body?.error_code ? `code=${body.error_code}` : null,
      body?.request_id ? `request_id=${body.request_id}` : null,
      `status=${err.status}`,
    ].filter(Boolean);
    return parts.join(" ") || `Zoo API error ${err.status}`;
  }
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return err instanceof Error ? err.message : String(err);
}

function isNotFoundError(message: string): boolean {
  return /ObjectNotFound|status=404|not found/i.test(message);
}

function extractKcl(op: unknown): string | null {
  if (!op || typeof op !== "object") return null;
  const code = "code" in op ? (op as { code?: unknown }).code : undefined;
  if (typeof code === "string" && code.trim()) return code;
  return null;
}

function completedResult(
  op: TextToCadResponse,
  id: string,
): CadResult<{ kcl: string; id: string }> | null {
  if (op.status !== "completed") return null;
  const kcl = extractKcl(op);
  if (!kcl) {
    return { ok: false, error: `Zoo completed without KCL code (zooOpId=${id})` };
  }
  return { ok: true, data: { kcl, id } };
}

/** One-shot fetch; used on cancel so we don't discard a finished Zoo job. */
async function tryFetchCompleted(
  client: Client,
  id: string,
): Promise<CadResult<{ kcl: string; id: string }> | null> {
  try {
    const op = await ml.get_text_to_cad_part_for_user({ client, id });
    if (op.status === "failed") {
      return { ok: false, error: op.error ?? `Zoo CAD operation failed (zooOpId=${id})` };
    }
    const done = completedResult(op, id);
    if (done?.ok) {
      console.log(`[zoo] id=${id} completed on final fetch kclChars=${done.data.kcl.length}`);
    }
    return done;
  } catch (err) {
    console.warn(`[zoo] final fetch failed id=${id}:`, asError(err));
    return null;
  }
}

/**
 * Poll the dedicated text-to-CAD part endpoint (returns KCL on `code`).
 * Prefer this over the generic `/async/operations/{id}` for ML parts.
 */
async function pollTextToCad(
  client: Client,
  id: string,
  signal?: AbortSignal,
): Promise<CadResult<{ kcl: string; id: string }>> {
  console.log(`[zoo] polling text-to-CAD part id=${id} (up to ~${(MAX_POLLS * POLL_MS) / 1000}s)`);
  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal?.aborted) {
      const rescued = await tryFetchCompleted(client, id);
      if (rescued) return rescued;
      console.warn(`[zoo] poll cancelled id=${id} after ${i * POLL_MS}ms`);
      return {
        ok: false,
        error: `CAD generation cancelled (zooOpId=${id}). Call text_to_cad again with zooOpId to resume once Zoo finishes.`,
      };
    }

    let op: TextToCadResponse;
    try {
      op = await ml.get_text_to_cad_part_for_user({ client, id });
    } catch (err) {
      console.warn(`[zoo] get_text_to_cad_part_for_user failed id=${id}:`, asError(err));
      return { ok: false, error: `${asError(err)} (zooOpId=${id})` };
    }

    if (op.status === "failed") {
      console.warn(`[zoo] id=${id} failed:`, op.error ?? "unknown");
      return { ok: false, error: `${op.error ?? "Zoo CAD operation failed"} (zooOpId=${id})` };
    }
    const done = completedResult(op, id);
    if (done) {
      if (done.ok) {
        console.log(
          `[zoo] id=${id} completed kclChars=${done.data.kcl.length} after ~${(i + 1) * POLL_MS}ms`,
        );
      }
      return done;
    }

    if (i > 0 && i % 8 === 0) {
      console.log(`[zoo] still waiting id=${id} status=${op.status} ~${(i * POLL_MS) / 1000}s`);
    }
    await sleep(POLL_MS, signal);
  }
  const rescued = await tryFetchCompleted(client, id);
  if (rescued) return rescued;
  console.warn(`[zoo] id=${id} timed out after ~${(MAX_POLLS * POLL_MS) / 1000}s`);
  return {
    ok: false,
    error: `Zoo CAD operation timed out after ~10 minutes (zooOpId=${id}). Pass zooOpId to text_to_cad to resume, or simplify the prompt.`,
  };
}

/**
 * Whole-file Zoo source range. Trailing newlines must not create a phantom
 * last line — Zoo rejects `end.line` past the last real line with
 * "Source range out of bounds" (which previously spun the assembly agent).
 */
export function wholeFileSourceRange(text: string): {
  start: { line: number; column: number };
  end: { line: number; column: number };
} {
  const stripped = text.replace(/\n+$/u, "");
  if (!stripped) {
    return { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } };
  }
  const lines = stripped.split("\n");
  const last = lines.length - 1;
  return {
    start: { line: 0, column: 0 },
    end: { line: last, column: lines[last]!.length },
  };
}

export type ZooCadAdapterOptions = {
  token: string;
  baseUrl?: string;
};

function pickMainKcl(files: Record<string, string>): string | null {
  if (typeof files["main.kcl"] === "string" && files["main.kcl"].trim()) {
    return files["main.kcl"];
  }
  const first = Object.values(files).find((c) => c.trim());
  return first?.trim() ? first : null;
}

/** Zoo / KittyCAD adapter — Zookeeper ML + Zoo MCP tools. */
export function createZooCadAdapter(opts: ZooCadAdapterOptions): CadPort {
  const token = opts.token.trim();
  if (!token) {
    throw new Error("ZOO_API_TOKEN is empty");
  }
  const client = new Client({
    token,
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
  });
  const mcp = new ZooMcpClient({ token });

  return {
    executeKcl: (input) => mcp.executeKcl(input),
    boundingBoxKcl: (input) => mcp.boundingBoxKcl(input),
    multiviewSnapshotKcl: (input) => mcp.multiviewSnapshotKcl(input),

    async textToCad(prompt, options) {
      try {
        if (options?.signal?.aborted) {
          return { ok: false, error: "CAD generation cancelled" };
        }
        if (!prompt.trim()) {
          return {
            ok: false,
            error:
              "text_to_cad needs a prompt (do not invent zooOpId — only reuse ids from prior tool errors)",
          };
        }

        // Legacy resume: older runs used REST async ops. Still poll those.
        const resumeId = options?.existingOpId?.trim();
        if (resumeId && isPlausibleZooOpId(resumeId)) {
          console.log(`[zoo] resuming legacy text-to-CAD id=${resumeId}`);
          const resumed = await pollTextToCad(client, resumeId, options?.signal);
          if (resumed.ok) return resumed;
          if (!isNotFoundError(resumed.error)) return resumed;
          console.warn(`[zoo] resume id=${resumeId} not found — starting Zookeeper turn`);
        } else if (resumeId && !isPlausibleZooOpId(resumeId)) {
          console.warn(`[zoo] ignoring implausible zooOpId=${resumeId}`);
        }

        const zk = await zookeeperPrompt({
          token,
          prompt,
          currentFiles: { "main.kcl": "" },
          projectName: options?.projectName,
          forcedTools: ["text_to_cad"],
          signal: options?.signal,
          timeoutMs: options?.timeoutMs,
          onProgress: options?.onProgress,
        });
        if (!zk.ok) return zk;
        const kcl = pickMainKcl(zk.data.files);
        if (!kcl) return { ok: false, error: "Zookeeper text-to-CAD returned no main.kcl" };
        return {
          ok: true,
          data: { kcl, id: zk.data.promptId ?? zk.data.conversationId },
        };
      } catch (err) {
        return { ok: false, error: asError(err) };
      }
    },

    async textToCadProject(prompt, options) {
      try {
        if (options?.signal?.aborted) {
          return { ok: false, error: "CAD generation cancelled" };
        }
        if (!prompt.trim()) {
          return { ok: false, error: "textToCadProject needs a prompt" };
        }
        const zk = await zookeeperPrompt({
          token,
          prompt,
          currentFiles: { "main.kcl": "" },
          projectName: options?.projectName,
          forcedTools: ["text_to_cad"],
          signal: options?.signal,
          timeoutMs: options?.timeoutMs,
          onProgress: options?.onProgress,
        });
        if (!zk.ok) return zk;
        const files = Object.fromEntries(
          Object.entries(zk.data.files).filter(([, content]) => content.trim().length > 0),
        );
        if (Object.keys(files).length === 0) {
          return { ok: false, error: "Zookeeper text-to-CAD returned no KCL files" };
        }
        return {
          ok: true,
          data: { files, id: zk.data.promptId ?? zk.data.conversationId },
        };
      } catch (err) {
        return { ok: false, error: asError(err) };
      }
    },

    async iterateCad(kcl, prompt, options) {
      try {
        if (options?.signal?.aborted) {
          return { ok: false, error: "CAD generation cancelled" };
        }
        if (!prompt.trim()) {
          return { ok: false, error: "iterateCad needs a prompt" };
        }
        const zk = await zookeeperPrompt({
          token,
          prompt,
          currentFiles: { "main.kcl": kcl },
          projectName: options?.projectName,
          forcedTools: ["edit_kcl_code"],
          signal: options?.signal,
          timeoutMs: options?.timeoutMs,
          onProgress: options?.onProgress,
        });
        if (!zk.ok) return zk;
        const next = pickMainKcl(zk.data.files);
        if (!next) return { ok: false, error: "Zookeeper iteration returned no main.kcl" };
        return {
          ok: true,
          data: { kcl: next, id: zk.data.promptId ?? zk.data.conversationId },
        };
      } catch (err) {
        return { ok: false, error: asError(err) };
      }
    },

    async iterateCadProject(files, prompt, options?: CadProjectIterateOptions) {
      try {
        if (options?.signal?.aborted) {
          return { ok: false, error: "CAD generation cancelled" };
        }
        const entries = Object.entries(files).filter(([, content]) => content.trim().length > 0);
        if (entries.length === 0) {
          return { ok: false, error: "iterateCadProject needs at least one non-empty KCL file" };
        }
        if (!prompt.trim()) {
          return { ok: false, error: "iterateCadProject needs a prompt" };
        }

        const currentFiles = Object.fromEntries(entries);
        const focusPath = options?.focusPath?.trim();
        console.log(
          `[zoo] zookeeper multi-file files=${entries.length} focus=${focusPath ?? "(all)"}`,
        );

        const forcedTools = options?.forcedTools?.length
          ? options.forcedTools
          : (["edit_kcl_code"] as const);
        const zk = await zookeeperPrompt({
          token,
          prompt,
          currentFiles,
          projectName: options?.projectName,
          forcedTools: [...forcedTools],
          signal: options?.signal,
          timeoutMs: options?.timeoutMs,
          onProgress: options?.onProgress,
        });
        if (!zk.ok) return zk;
        if (Object.keys(zk.data.files).length === 0) {
          return { ok: false, error: "Zookeeper multi-file edit returned no KCL outputs" };
        }
        // Merge so unchanged attachments stay present when Zoo only returns diffs.
        const merged = { ...currentFiles, ...zk.data.files };
        return {
          ok: true,
          data: {
            files: merged,
            id: zk.data.promptId ?? zk.data.conversationId,
          },
        };
      } catch (err) {
        return { ok: false, error: asError(err) };
      }
    },
  };
}
