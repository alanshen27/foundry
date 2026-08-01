/**
 * Zoo Zookeeper WebSocket client (recommended Agent API).
 *
 * Replaces deprecated REST Text-to-CAD / multi-file iteration:
 *   POST /ai/text-to-cad/{format}
 *   POST /ml/text-to-cad/iteration
 *   POST /ml/text-to-cad/multi-file/iteration
 *
 * Endpoint: wss://api.zoo.dev/ws/ml/copilot (JSON text frames).
 * Docs also mention `/ws/ml/zookeeper`; that path currently 404s — copilot is
 * what `@kittycad/lib` and live API accept.
 * @see https://zoo.dev/docs/developer-tools/api/ml/open-a-websocket-to-prompt-the-ml-copilot
 */

import { decode as msgpackDecode } from "@msgpack/msgpack";
// Must precede the `ws` import: it picks its frame masker at load time.
import "./ws-masking";
import WebSocket from "ws";
import type { CadResult } from "./port";

/** SDK path (`/ws/ml/copilot`). Docs also mention `/ws/ml/zookeeper` — that 404s today. */
const DEFAULT_WS_URL = "wss://api.zoo.dev/ws/ml/copilot";
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
/** Keepalive cadence and silence budget, matching Zoo's own copilot client. */
const HEARTBEAT_INTERVAL_MS = 4_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;
/** Sockets per turn: the first attempt plus two resumes. */
const MAX_ATTEMPTS = 3;

export type ZookeeperPromptOptions = {
  token: string;
  prompt: string;
  /** path → KCL source (UTF-8). Empty string allowed for new generation. */
  currentFiles: Record<string, string>;
  projectName?: string;
  forcedTools?: Array<"edit_kcl_code" | "text_to_cad">;
  signal?: AbortSignal;
  timeoutMs?: number;
  baseWsUrl?: string;
  /** Narration of the turn (model reasoning, files, reconnects). */
  onProgress?: ZookeeperProgress;
};

/** Human-readable note about what the turn is doing right now. */
export type ZookeeperProgress = (note: string) => void;

export type ZookeeperPromptResult = {
  files: Record<string, string>;
  conversationId: string;
  promptId?: string;
};

type ServerMessage = Record<string, unknown>;

/** Recursively find a path→KCL map in tool_output / project_updated payloads. */
export function extractKclOutputs(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractKclOutputs(item);
      if (found) return found;
    }
    return null;
  }

  const obj = value as Record<string, unknown>;

  const outputs = obj.outputs;
  if (outputs && typeof outputs === "object" && !Array.isArray(outputs)) {
    const out = stringMap(outputs as Record<string, unknown>);
    if (Object.keys(out).length > 0) return out;
  }

  const files = obj.files;
  if (files && typeof files === "object" && !Array.isArray(files)) {
    const asMap = stringMap(files as Record<string, unknown>);
    if (Object.keys(asMap).length > 0) return asMap;
  }

  for (const key of ["result", "tool_output", "project_updated"] as const) {
    if (key in obj) {
      const nested = extractKclOutputs(obj[key]);
      if (nested) return nested;
    }
  }

  for (const child of Object.values(obj)) {
    if (child && typeof child === "object") {
      const nested = extractKclOutputs(child);
      if (nested) return nested;
    }
  }
  return null;
}

function stringMap(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(raw)) {
    if (typeof content === "string" && content.trim()) out[path] = content;
  }
  return out;
}

/** Longest prefix of the copilot's own narration worth surfacing to a user. */
const NARRATION_LIMIT = 240;

function flatten(value: unknown, limit = NARRATION_LIMIT): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * One-line summary of a `reasoning` frame, if this message is one.
 *
 * `ReasoningMessage` is a union discriminated on `type` (Zoo OpenAPI; typed in
 * `@kittycad/lib`). Only the prose variants carry `content` — a design plan
 * carries `steps`, a KCL error carries `error`, file events carry `file_name` —
 * so reading `content` alone drops the frames that actually say what the turn
 * is doing. Reference-dump variants (docs, examples, feature tree) are reported
 * as a label instead of their payload, which runs to pages.
 */
export function reasoningText(msg: ServerMessage): string | null {
  const reasoning = msg.reasoning;
  if (!reasoning || typeof reasoning !== "object") return null;
  const frame = reasoning as Record<string, unknown>;

  switch (frame.type) {
    case "design_plan": {
      const steps = Array.isArray(frame.steps) ? (frame.steps as Record<string, unknown>[]) : [];
      if (steps.length === 0) return "Planning the model";
      const first = flatten(steps[0]?.edit_instructions, 120);
      const file = flatten(steps[0]?.filepath_to_edit, 60);
      return `Plan (${steps.length} step${steps.length === 1 ? "" : "s"})${
        file ? ` · ${file}` : ""
      }${first ? `: ${first}` : ""}`;
    }
    case "generated_kcl_code": {
      const code = typeof frame.code === "string" ? frame.code : "";
      return `Generated ${code.split("\n").length} lines of KCL`;
    }
    case "kcl_code_error":
      return `KCL error — ${flatten(frame.error) ?? "unspecified"}`;
    case "created_kcl_file":
    case "created_project_file":
      return `Created ${flatten(frame.file_name, 80) ?? "a file"}`;
    case "updated_kcl_file":
    case "updated_project_file":
      return `Updated ${flatten(frame.file_name, 80) ?? "a file"}`;
    case "deleted_kcl_file":
    case "deleted_project_file":
      return `Deleted ${flatten(frame.file_name, 80) ?? "a file"}`;
    case "kcl_docs":
      return "Consulting KCL documentation";
    case "kcl_code_examples":
      return "Reviewing KCL examples";
    case "feature_tree_outline":
      return "Reading the feature tree";
    default:
      // `text`, `markdown`, and any variant Zoo adds later.
      return flatten(frame.content);
  }
}

/** Summary of a `tool_output` frame — the per-tool verdict, error included. */
export function toolResultText(msg: ServerMessage): string | null {
  const output = msg.tool_output;
  if (!output || typeof output !== "object") return null;
  const result = (output as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  const { type, error, status_code: status } = result as Record<string, unknown>;
  const tool = flatten(type, 60);
  const detail = flatten(error);
  if (detail) return `${tool ?? "Tool"} failed: ${detail}`;
  // An untyped result says nothing the file list doesn't already say.
  if (!tool) return null;
  return `${tool} finished${typeof status === "number" && status >= 400 ? ` (status ${status})` : ""}`;
}

/**
 * Explain a socket that closed without a usable result.
 *
 * Zoo hangs up mid-turn often enough that a bare "closed without outputs" is
 * unactionable: the close code separates a server-side drop (1006 — no close
 * frame) from a deliberate close, and the copilot's last `reasoning` frame is
 * usually the real answer, since it narrates why it gave up (ambiguous prompt,
 * unsupported geometry) before the socket goes away.
 */
export function closeFailureMessage(info: {
  code: number;
  reason: string;
  hadFiles: boolean;
  narration: string | null;
}): string {
  const reason = info.reason.trim();
  const base = info.hadFiles
    ? "Zoo Zookeeper closed before end_of_stream"
    : "Zoo Zookeeper closed without outputs";
  return withNarration(
    `${base} (close ${info.code}${reason ? `: ${reason}` : ""})`,
    info.narration,
  );
}

/** Append the copilot's last narration to a failure message. */
export function withNarration(base: string, narration: string | null): string {
  if (!narration) return base;
  const text =
    narration.length > NARRATION_LIMIT ? `${narration.slice(0, NARRATION_LIMIT)}…` : narration;
  return `${base} — last from the model: "${text}"`;
}

/** Timeouts are minutes long; report them in the unit the user waited in. */
function timeoutError(totalMs: number): string {
  const seconds = Math.round(totalMs / 1000);
  const label = seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`;
  return `Zoo Zookeeper timed out after ~${label}`;
}

function errorDetail(msg: ServerMessage): string {
  const err = msg.error;
  return typeof err === "string" || (err && typeof err === "object")
    ? "The CAD generation service rejected the request."
    : "The CAD generation service could not complete the request.";
}

/** Everything one turn accumulates; survives reconnects within that turn. */
type TurnState = {
  conversationId: string;
  promptId?: string;
  files: Record<string, string> | null;
  narration: string | null;
};

/**
 * A single socket either settles the turn or loses the connection under it.
 * Only `dropped` is retryable — a service `error` frame is a real answer.
 */
type AttemptOutcome =
  | { kind: "settled"; result: CadResult<ZookeeperPromptResult> }
  | { kind: "dropped"; detail: string };

function turnResult(state: TurnState): CadResult<ZookeeperPromptResult> {
  if (!state.files || Object.keys(state.files).length === 0) {
    return {
      ok: false,
      error: withNarration("Zoo Zookeeper finished without KCL file outputs", state.narration),
    };
  }
  return {
    ok: true,
    data: {
      files: state.files,
      conversationId: state.conversationId || state.promptId || "zookeeper",
      promptId: state.promptId,
    },
  };
}

/** Coerce a MsgPack `bin` element to bytes (decoders differ on the shape). */
function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (value && typeof value === "object") {
    return Uint8Array.from(Object.values(value) as number[]);
  }
  return null;
}

/**
 * Server frames carried by one WebSocket message.
 *
 * Live traffic is one JSON frame. A resumed socket (`?replay=true`) first gets
 * a single MsgPack binary frame holding every persisted message of the
 * conversation, which we flatten so the turn can be rebuilt from it.
 */
export function decodeFrames(data: unknown, isBinary: boolean): ServerMessage[] {
  if (!isBinary) {
    const raw = typeof data === "string" ? data : Buffer.from(data as Buffer).toString("utf8");
    return [JSON.parse(raw) as ServerMessage];
  }

  const decoded = msgpackDecode(Buffer.from(data as Buffer)) as unknown;
  if (!decoded || typeof decoded !== "object") return [];
  const replay = (decoded as { replay?: { messages?: unknown[] } }).replay;
  if (!replay?.messages) return [decoded as ServerMessage];

  const frames: ServerMessage[] = [];
  for (const element of replay.messages) {
    const bytes = toBytes(element);
    if (!bytes) continue;
    try {
      frames.push(JSON.parse(new TextDecoder().decode(bytes)) as ServerMessage);
    } catch {
      // A replay entry we can't read shouldn't sink the whole recovery.
    }
  }
  console.log(`[zookeeper] replayed ${frames.length} messages`);
  return frames;
}

/** Fold one server frame into the turn; non-null means the turn is over. */
export function applyMessage(
  msg: ServerMessage,
  state: TurnState,
  onProgress?: ZookeeperProgress,
): AttemptOutcome | null {
  if ("conversation_id" in msg) {
    const block = msg.conversation_id;
    if (typeof block === "string") state.conversationId = block;
    else if (block && typeof block === "object" && "conversation_id" in block) {
      state.conversationId = String((block as { conversation_id?: unknown }).conversation_id ?? "");
    }
    if (state.conversationId) console.log(`[zookeeper] conversation=${state.conversationId}`);
    return null;
  }

  if ("backend_shutdown" in msg) {
    const shutdown = msg.backend_shutdown;
    const reason =
      shutdown && typeof shutdown === "object"
        ? ((shutdown as { reason?: unknown }).reason ?? "")
        : "";
    return {
      kind: "dropped",
      detail: `Zoo Zookeeper backend is restarting${reason ? `: ${String(reason)}` : ""}`,
    };
  }

  if ("error" in msg) {
    return { kind: "settled", result: { ok: false, error: errorDetail(msg) } };
  }

  const reasoning = reasoningText(msg);
  if (reasoning) {
    state.narration = reasoning;
    onProgress?.(reasoning);
    return null;
  }

  if ("info" in msg) {
    const text = flatten((msg.info as { text?: unknown } | undefined)?.text);
    if (text) {
      state.narration = text;
      onProgress?.(text);
    }
    return null;
  }

  if ("project_updated" in msg || "tool_output" in msg) {
    const verdict = toolResultText(msg);
    if (verdict) {
      state.narration = verdict;
      onProgress?.(verdict);
    }
    const files = extractKclOutputs(msg);
    if (files) {
      state.files = files;
      const names = Object.keys(files);
      console.log(`[zookeeper] got files=${names.join(",")}`);
      onProgress?.(`Received ${names.length} KCL file(s): ${names.join(", ")}`);
    }
    return null;
  }

  if ("end_of_stream" in msg) {
    const eos = msg.end_of_stream;
    if (eos && typeof eos === "object") {
      const e = eos as { conversation_id?: string; id?: string };
      if (e.conversation_id) state.conversationId = e.conversation_id;
      if (e.id) state.promptId = String(e.id);
    }
    return { kind: "settled", result: turnResult(state) };
  }

  return null;
}

/** One WebSocket connection's worth of the turn. */
function runAttempt(args: {
  wsUrl: string;
  token: string;
  /** Sent once the socket opens: the user turn, or `continue` when resuming. */
  open: Record<string, unknown>;
  resume: boolean;
  state: TurnState;
  signal?: AbortSignal;
  budgetMs: number;
  totalMs: number;
  onProgress?: ZookeeperProgress;
}): Promise<AttemptOutcome> {
  const { state } = args;
  const url = args.resume
    ? `${args.wsUrl}?conversation_id=${encodeURIComponent(state.conversationId)}&replay=true`
    : args.wsUrl;

  return new Promise<AttemptOutcome>((resolve) => {
    let settled = false;
    let lastFrameAt = Date.now();

    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${args.token}`,
        "User-Agent": "foundry-zookeeper/0.1",
      },
    });

    const finish = (outcome: AttemptOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(budgetTimer);
      clearInterval(heartbeat);
      args.signal?.removeEventListener("abort", onAbort);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      resolve(outcome);
    };

    const onAbort = () =>
      finish({ kind: "settled", result: { ok: false, error: "CAD generation cancelled" } });

    /**
     * A throwing `send` has to end the attempt.
     *
     * It fires inside a socket callback, so an escaping error becomes an
     * uncaught exception and the turn hangs until its deadline with the prompt
     * never delivered — exactly what a bundled `ws` does when its optional
     * `bufferutil` binding is mangled and masking is unavailable.
     */
    const send = (payload: Record<string, unknown>) => {
      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        finish({
          kind: "settled",
          result: {
            ok: false,
            error: `Zoo Zookeeper could not send on the socket: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        });
      }
    };

    const budgetTimer = setTimeout(() => {
      finish({
        kind: "settled",
        result: { ok: false, error: timeoutError(args.totalMs) },
      });
    }, args.budgetMs);

    // Zoo hangs up on a socket it thinks is idle, and a half-open one otherwise
    // stays "connected" for the whole turn budget.
    const heartbeat = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastFrameAt >= HEARTBEAT_TIMEOUT_MS) {
        finish({ kind: "dropped", detail: "Zoo Zookeeper stopped responding" });
        return;
      }
      send({ type: "ping" });
    }, HEARTBEAT_INTERVAL_MS);

    args.signal?.addEventListener("abort", onAbort, { once: true });

    ws.on("open", () => send(args.open));

    ws.on("message", (data, isBinary) => {
      lastFrameAt = Date.now();
      let frames: ServerMessage[];
      try {
        frames = decodeFrames(data, isBinary);
      } catch {
        console.warn("[zookeeper] ignored an invalid service message");
        return;
      }
      for (const frame of frames) {
        const outcome = applyMessage(frame, state, args.onProgress);
        if (outcome) {
          finish(outcome);
          return;
        }
      }
    });

    ws.on("error", () => {
      finish({ kind: "dropped", detail: "The CAD generation service connection failed." });
    });

    ws.on("close", (code: number, reasonBuf: Buffer) => {
      finish({
        kind: "dropped",
        detail: closeFailureMessage({
          code,
          reason: reasonBuf?.toString("utf8") ?? "",
          hadFiles: state.files !== null,
          narration: state.narration,
        }),
      });
    });
  });
}

/**
 * Run one Zookeeper prompt turn and collect the latest project file map.
 *
 * Zoo drops long-running sockets often enough that a single connection loses
 * whole multi-minute generations, so a dropped turn is resumed rather than
 * regenerated: reconnect with `?conversation_id=…&replay=true` (the server
 * replays what it already produced) and send `system: continue` to pick the
 * turn back up.
 */
export async function zookeeperPrompt(
  opts: ZookeeperPromptOptions,
): Promise<CadResult<ZookeeperPromptResult>> {
  const token = opts.token.trim();
  if (!token) return { ok: false, error: "ZOO_API_TOKEN is empty" };
  if (!opts.prompt.trim()) return { ok: false, error: "Zookeeper needs a prompt" };

  const wsUrl = (opts.baseWsUrl ?? DEFAULT_WS_URL).replace(/^http/, "ws");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  const request = {
    type: "user" as const,
    content: opts.prompt,
    ...(opts.projectName ? { project_name: opts.projectName } : {}),
    current_files: opts.currentFiles,
    ...(opts.forcedTools?.length ? { forced_tools: opts.forcedTools } : {}),
  };

  console.log(
    `[zookeeper] prompt files=${Object.keys(opts.currentFiles).length} tools=${
      opts.forcedTools?.join(",") ?? "(auto)"
    }`,
  );

  const state: TurnState = { conversationId: "", files: null, narration: null };
  let drop = "Zoo Zookeeper closed without outputs";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (opts.signal?.aborted) return { ok: false, error: "CAD generation cancelled" };
    const budgetMs = deadline - Date.now();
    if (budgetMs <= 0) return { ok: false, error: timeoutError(timeoutMs) };

    const resume = attempt > 0;
    if (resume) {
      console.warn(
        `[zookeeper] ${drop} — resuming conversation=${state.conversationId} (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
      );
      opts.onProgress?.(
        `Zoo dropped the connection — resuming the same turn (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
      );
    }

    const outcome = await runAttempt({
      wsUrl,
      token,
      resume,
      state,
      signal: opts.signal,
      budgetMs,
      totalMs: timeoutMs,
      onProgress: opts.onProgress,
      open: resume ? { type: "system", command: "continue" } : request,
    });

    if (outcome.kind === "settled") {
      if (outcome.result.ok) {
        console.log(
          `[zookeeper] ok conversation=${outcome.result.data.conversationId} files=${
            Object.keys(outcome.result.data.files).length
          }`,
        );
      } else {
        console.warn("[zookeeper] request failed");
      }
      return outcome.result;
    }

    drop = outcome.detail;
    // Resuming replays a conversation; without an id there is nothing to rejoin.
    if (!state.conversationId) break;
  }

  console.warn("[zookeeper] request failed");
  return { ok: false, error: drop };
}
