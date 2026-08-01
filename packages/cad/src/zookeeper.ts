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

import WebSocket from "ws";
import type { CadResult } from "./port";

/** SDK path (`/ws/ml/copilot`). Docs also mention `/ws/ml/zookeeper` — that 404s today. */
const DEFAULT_WS_URL = "wss://api.zoo.dev/ws/ml/copilot";
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

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
};

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

/** Text of a `reasoning` frame, if this message is one. */
export function reasoningText(msg: ServerMessage): string | null {
  const reasoning = msg.reasoning;
  if (!reasoning || typeof reasoning !== "object") return null;
  const content = (reasoning as { content?: unknown }).content;
  if (typeof content !== "string") return null;
  const trimmed = content.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
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

function errorDetail(msg: ServerMessage): string {
  const err = msg.error;
  return typeof err === "string" || (err && typeof err === "object")
    ? "The CAD generation service rejected the request."
    : "The CAD generation service could not complete the request.";
}

/**
 * Run one Zookeeper prompt turn and collect the latest project file map.
 */
export async function zookeeperPrompt(
  opts: ZookeeperPromptOptions,
): Promise<CadResult<ZookeeperPromptResult>> {
  const token = opts.token.trim();
  if (!token) return { ok: false, error: "ZOO_API_TOKEN is empty" };
  if (!opts.prompt.trim()) return { ok: false, error: "Zookeeper needs a prompt" };

  const wsUrl = (opts.baseWsUrl ?? DEFAULT_WS_URL).replace(/^http/, "ws");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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

  let conversationId = "";
  let promptId: string | undefined;
  let latestFiles: Record<string, string> | null = null;
  let sawEnd = false;
  let narration: string | null = null;

  return new Promise<CadResult<ZookeeperPromptResult>>((resolve) => {
    let settled = false;

    const ws = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "foundry-zookeeper/0.1",
      },
    });

    const finish = (result: CadResult<ZookeeperPromptResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (result.ok) {
        console.log(
          `[zookeeper] ok conversation=${result.data.conversationId} files=${Object.keys(result.data.files).length}`,
        );
      } else {
        console.warn("[zookeeper] request failed");
      }
      resolve(result);
    };

    const onAbort = () => {
      finish({ ok: false, error: "CAD generation cancelled" });
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: `Zoo Zookeeper timed out after ~${Math.round(timeoutMs / 1000)}s`,
      });
    }, timeoutMs);

    opts.signal?.addEventListener("abort", onAbort, { once: true });

    ws.on("open", () => {
      ws.send(JSON.stringify(request));
    });

    ws.on("message", (data) => {
      try {
        const raw = typeof data === "string" ? data : Buffer.from(data as Buffer).toString("utf8");
        const msg = JSON.parse(raw) as ServerMessage;

        if ("conversation_id" in msg) {
          const block = msg.conversation_id;
          if (typeof block === "string") conversationId = block;
          else if (block && typeof block === "object" && "conversation_id" in block) {
            conversationId = String((block as { conversation_id?: unknown }).conversation_id ?? "");
          }
          if (conversationId) console.log(`[zookeeper] conversation=${conversationId}`);
          return;
        }

        if ("error" in msg) {
          finish({ ok: false, error: errorDetail(msg) });
          return;
        }

        const reasoning = reasoningText(msg);
        if (reasoning) {
          narration = reasoning;
          return;
        }

        if ("project_updated" in msg || "tool_output" in msg) {
          const files = extractKclOutputs(msg);
          if (files) {
            latestFiles = files;
            console.log(`[zookeeper] got files=${Object.keys(files).join(",")}`);
          }
          return;
        }

        if ("end_of_stream" in msg) {
          sawEnd = true;
          const eos = msg.end_of_stream;
          if (eos && typeof eos === "object") {
            const e = eos as { conversation_id?: string; id?: string };
            if (e.conversation_id) conversationId = e.conversation_id;
            if (e.id) promptId = String(e.id);
          }
          if (!latestFiles || Object.keys(latestFiles).length === 0) {
            finish({
              ok: false,
              error: withNarration("Zoo Zookeeper finished without KCL file outputs", narration),
            });
            return;
          }
          finish({
            ok: true,
            data: {
              files: latestFiles,
              conversationId: conversationId || promptId || "zookeeper",
              promptId,
            },
          });
        }
      } catch {
        console.warn("[zookeeper] ignored an invalid service message");
      }
    });

    ws.on("error", () => {
      finish({
        ok: false,
        error: "The CAD generation service connection failed.",
      });
    });

    ws.on("close", (code: number, reasonBuf: Buffer) => {
      if (settled) return;
      if (sawEnd && latestFiles && Object.keys(latestFiles).length > 0) {
        finish({
          ok: true,
          data: {
            files: latestFiles,
            conversationId: conversationId || promptId || "zookeeper",
            promptId,
          },
        });
        return;
      }
      finish({
        ok: false,
        error: closeFailureMessage({
          code,
          reason: reasonBuf?.toString("utf8") ?? "",
          hadFiles: latestFiles !== null,
          narration,
        }),
      });
    });
  });
}
