import { z } from "zod";

/**
 * Dev-only CAD Lab (/dev/cad-lab): request contract for exercising Zoo ML
 * text-to-CAD, Zoo MCP KCL tools, and arbitrary stdio CAD MCP servers.
 */

/** Runners a custom MCP server may be spawned with (no arbitrary binaries). */
export const CAD_LAB_MCP_COMMANDS = ["uvx", "npx", "node", "python3", "python"] as const;

export type CadLabMcpCommand = (typeof CAD_LAB_MCP_COMMANDS)[number];

const mcpServerSchema = z.object({
  command: z.enum(CAD_LAB_MCP_COMMANDS),
  args: z.array(z.string().min(1)).max(16).default([]),
  env: z.record(z.string()).optional(),
});

export const cadLabRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("zoo_prompt_render"),
    prompt: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("zoo_text_to_cad"),
    prompt: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("zoo_iterate"),
    prompt: z.string().trim().min(1),
    kcl: z.string().min(1),
  }),
  z.object({
    action: z.literal("zoo_execute"),
    kcl: z.string().min(1),
  }),
  z.object({
    action: z.literal("zoo_bbox"),
    kcl: z.string().min(1),
    unit: z.string().trim().min(1).optional(),
  }),
  z.object({
    action: z.literal("zoo_multiview"),
    kcl: z.string().min(1),
  }),
  z.object({
    action: z.literal("mcp_list_tools"),
    server: mcpServerSchema,
  }),
  z.object({
    action: z.literal("mcp_call_tool"),
    server: mcpServerSchema,
    tool: z.string().trim().min(1),
    toolArgs: z.record(z.unknown()).default({}),
  }),
]);

export type CadLabRequest = z.infer<typeof cadLabRequestSchema>;

export type CadLabRender = {
  ok: true;
  kind: "render";
  /** Entry file (`main.kcl`), kept for single-part convenience. */
  kcl: string;
  /** Every file Zoo returned — assemblies span several. */
  files: Record<string, string>;
  id: string;
  /** Data URIs: multiview collage + isometric collage (when available). */
  images: string[];
  executeOk: boolean;
  executeMessage: string;
  timings: { generateMs: number; executeMs: number; snapshotMs: number };
};

export type CadLabResponse =
  | CadLabRender
  | { ok: true; kind: "kcl"; kcl: string; id: string }
  | { ok: true; kind: "text"; text: string }
  | { ok: true; kind: "json"; data: unknown }
  | { ok: true; kind: "image"; dataUri: string; text?: string }
  | { ok: false; error: string };

/** Stages of a prompt→render run, in order. */
export const CAD_LAB_PHASES = ["generate", "execute", "snapshot"] as const;

export type CadLabPhase = (typeof CAD_LAB_PHASES)[number];

/**
 * NDJSON events streamed by `zoo_prompt_render`.
 *
 * A run takes minutes, so it reports as it goes instead of resolving one
 * silent response: the client can show the current stage and Zoo's own
 * narration, and the ticks keep the connection from looking dead.
 */
export type CadLabEvent =
  | { type: "phase"; phase: CadLabPhase }
  | { type: "note"; text: string }
  | { type: "tick"; elapsedMs: number }
  | { type: "result"; response: CadLabResponse };

/** Split streamed NDJSON into events, keeping any trailing partial line. */
export function parseEventLines(buffer: string): { events: CadLabEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: CadLabEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as CadLabEvent);
    } catch {
      // A malformed line shouldn't abort a run that may still produce a result.
    }
  }
  return { events, rest };
}

/** Whole-run ceiling: generation plus execute plus snapshots. */
export const CAD_LAB_DEFAULT_TIMEOUT_MS = 10 * 60_000;
const CAD_LAB_MIN_TIMEOUT_MS = 30_000;
const CAD_LAB_MAX_TIMEOUT_MS = 30 * 60_000;

/**
 * Deadline for one run, from `CAD_LAB_TIMEOUT_MS` (ms).
 *
 * Zoo can stall for as long as it likes; a run that answers with a timeout and
 * the model's last words beats one that holds the request open indefinitely.
 */
export function cadLabTimeoutMs(configured: string | undefined): number {
  const raw = Number(configured);
  if (!Number.isFinite(raw) || raw <= 0) return CAD_LAB_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(raw), CAD_LAB_MIN_TIMEOUT_MS), CAD_LAB_MAX_TIMEOUT_MS);
}

/** CAD Lab is dev-only unless explicitly enabled. */
export function cadLabEnabled(env: { NODE_ENV?: string; CAD_LAB_ENABLED?: string }): boolean {
  if (env.CAD_LAB_ENABLED === "1" || env.CAD_LAB_ENABLED === "true") return true;
  return env.NODE_ENV !== "production";
}
