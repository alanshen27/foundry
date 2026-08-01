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
  kcl: string;
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

/** CAD Lab is dev-only unless explicitly enabled. */
export function cadLabEnabled(env: { NODE_ENV?: string; CAD_LAB_ENABLED?: string }): boolean {
  if (env.CAD_LAB_ENABLED === "1" || env.CAD_LAB_ENABLED === "true") return true;
  return env.NODE_ENV !== "production";
}
