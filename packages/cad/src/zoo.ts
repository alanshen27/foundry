import { ApiError, Client, ml, api_calls, type TextToCadResponse } from "@kittycad/lib";
import type { CadPort, CadProjectIterateOptions, CadResult } from "./port";
import { ZooMcpClient } from "./mcp";
import { isPlausibleZooOpId } from "./op-id";

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

function extractOutputs(op: unknown): Record<string, string> | null {
  if (!op || typeof op !== "object") return null;
  const outputs = "outputs" in op ? (op as { outputs?: unknown }).outputs : undefined;
  if (!outputs || typeof outputs !== "object") return null;
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(outputs as Record<string, unknown>)) {
    if (typeof content === "string" && content.trim()) out[path] = content;
  }
  return Object.keys(out).length > 0 ? out : null;
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

/** Iteration jobs are async ops; poll the generic async endpoint for those. */
async function pollAsyncOp(
  client: Client,
  id: string,
  signal?: AbortSignal,
): Promise<CadResult<{ kcl: string; id: string }>> {
  console.log(`[zoo] polling async op=${id}`);
  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal?.aborted) {
      return { ok: false, error: "CAD generation cancelled" };
    }
    const op = await api_calls.get_async_operation({ client, id });
    if (op.status === "failed") {
      return { ok: false, error: op.error ?? "Zoo CAD operation failed" };
    }
    if (op.status === "completed") {
      const kcl = extractKcl(op);
      if (!kcl) {
        return { ok: false, error: "Zoo completed without KCL code" };
      }
      return { ok: true, data: { kcl, id } };
    }
    if (i > 0 && i % 8 === 0) {
      console.log(`[zoo] still waiting op=${id} status=${op.status} ~${(i * POLL_MS) / 1000}s`);
    }
    await sleep(POLL_MS, signal);
  }
  return {
    ok: false,
    error: "Zoo CAD operation timed out after ~10 minutes. Retry or simplify the prompt.",
  };
}

async function pollMultiFileOp(
  client: Client,
  id: string,
  signal?: AbortSignal,
): Promise<CadResult<{ files: Record<string, string>; id: string }>> {
  console.log(`[zoo] polling multi-file iteration op=${id}`);
  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal?.aborted) {
      return { ok: false, error: "CAD generation cancelled" };
    }
    const op = await api_calls.get_async_operation({ client, id });
    if (op.status === "failed") {
      return { ok: false, error: op.error ?? "Zoo multi-file iteration failed" };
    }
    if (op.status === "completed") {
      const files = extractOutputs(op);
      if (!files) {
        return { ok: false, error: "Zoo multi-file iteration completed without KCL outputs" };
      }
      console.log(
        `[zoo] multi-file op=${id} completed files=${Object.keys(files).length} after ~${(i + 1) * POLL_MS}ms`,
      );
      return { ok: true, data: { files, id } };
    }
    if (i > 0 && i % 8 === 0) {
      console.log(
        `[zoo] still waiting multi-file op=${id} status=${op.status} ~${(i * POLL_MS) / 1000}s`,
      );
    }
    await sleep(POLL_MS, signal);
  }
  return {
    ok: false,
    error: `Zoo multi-file iteration timed out after ~10 minutes (zooOpId=${id}).`,
  };
}

export type ZooCadAdapterOptions = {
  token: string;
  baseUrl?: string;
};

/** Zoo / KittyCAD adapter — ML text-to-CAD, KCL iteration, and Zoo MCP tools. */
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
      const create = async (): Promise<CadResult<{ kcl: string; id: string }>> => {
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
        const res = await ml.create_text_to_cad({
          client,
          output_format: "step",
          kcl: true,
          body: {
            prompt,
            ...(options?.projectName ? { project_name: options.projectName } : {}),
          },
        });
        if (res.status === "failed") {
          return { ok: false, error: res.error ?? "text-to-CAD failed" };
        }
        if (res.status === "completed") {
          const kcl = extractKcl(res);
          if (!kcl) return { ok: false, error: "text-to-CAD completed without KCL" };
          console.log(`[zoo] text-to-CAD completed immediately id=${res.id}`);
          return { ok: true, data: { kcl, id: res.id } };
        }
        console.log(`[zoo] text-to-CAD queued id=${res.id} status=${res.status}`);
        return pollTextToCad(client, res.id, options?.signal);
      };

      try {
        const resumeId = options?.existingOpId?.trim();
        if (resumeId && isPlausibleZooOpId(resumeId)) {
          console.log(`[zoo] resuming text-to-CAD id=${resumeId}`);
          const resumed = await pollTextToCad(client, resumeId, options?.signal);
          if (resumed.ok) return resumed;
          // Stale/wrong id: if the caller also sent a prompt, start a real job.
          if (isNotFoundError(resumed.error) && prompt.trim()) {
            console.warn(
              `[zoo] resume id=${resumeId} not found — creating new text-to-CAD from prompt`,
            );
            return create();
          }
          return resumed;
        }
        if (resumeId && !isPlausibleZooOpId(resumeId)) {
          console.warn(`[zoo] ignoring implausible zooOpId=${resumeId}`);
        }
        return create();
      } catch (err) {
        return { ok: false, error: asError(err) };
      }
    },

    async iterateCad(kcl, prompt, options) {
      try {
        if (options?.signal?.aborted) {
          return { ok: false, error: "CAD generation cancelled" };
        }
        const res = await ml.create_text_to_cad_iteration({
          client,
          body: {
            original_source_code: kcl,
            prompt,
            source_ranges: [],
            ...(options?.projectName ? { project_name: options.projectName } : {}),
          },
        });
        if (res.status === "failed") {
          return { ok: false, error: res.error ?? "CAD iteration failed" };
        }
        if (res.status === "completed") {
          if (!res.code?.trim()) {
            return { ok: false, error: "CAD iteration completed without KCL" };
          }
          return { ok: true, data: { kcl: res.code, id: res.id } };
        }
        return pollAsyncOp(client, res.id, options?.signal);
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

        const focusPath = options?.focusPath?.trim();
        const focusContent = focusPath ? (files[focusPath] ?? "") : "";
        // Prefer an empty range list (same as single-file iterateCad) when we
        // don't have a focus file. When we do, clamp to real lines only —
        // never `split("\n").length - 1` on trailing `\n` (Zoo 400).
        const source_ranges =
          focusPath && focusContent.trim()
            ? [
                {
                  file: focusPath,
                  prompt,
                  range: wholeFileSourceRange(focusContent),
                },
              ]
            : [];

        const attached = entries.map(([name, content]) => ({
          name,
          data: new Blob([content], { type: "text/plain" }),
        }));

        console.log(
          `[zoo] multi-file iteration files=${attached.length} focus=${focusPath ?? "(all)"} rangeEnd=${
            source_ranges[0]?.range.end.line ?? "-"
          }`,
        );
        const res = await ml.create_text_to_cad_multi_file_iteration({
          client,
          files: attached,
          body: {
            prompt,
            source_ranges,
            ...(options?.projectName ? { project_name: options.projectName } : {}),
          },
        });
        if (res.status === "failed") {
          return { ok: false, error: res.error ?? "Zoo multi-file iteration failed" };
        }
        if (res.status === "completed") {
          const out = extractOutputs(res);
          if (!out) {
            return { ok: false, error: "Zoo multi-file iteration completed without KCL outputs" };
          }
          return { ok: true, data: { files: out, id: res.id } };
        }
        return pollMultiFileOp(client, res.id, options?.signal);
      } catch (err) {
        return { ok: false, error: asError(err) };
      }
    },
  };
}
