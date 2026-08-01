import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CadBoundingBox, CadResult } from "./port";

/**
 * Engine calls are seconds; the first `uvx zoo-mcp` of a machine also pays a
 * Python cold start. Anything past this is hung, not slow.
 */
const DEFAULT_MCP_TIMEOUT_MS = 180_000;

export type ZooMcpOptions = {
  token: string;
  /** Override spawn command (default: uvx zoo-mcp). */
  command?: string;
  args?: string[];
  /** Extra environment for the spawned MCP server. */
  env?: Record<string, string>;
  /** Per-request ceiling, spawn/handshake included (default 180s). */
  timeoutMs?: number;
  /** Abandon in-flight tool calls (caller deadline / client disconnect). */
  signal?: AbortSignal;
};

export type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type McpToolCallOutput = {
  text: string;
  images: Array<{ mimeType: string; base64: string }>;
  structured?: unknown;
};

type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType?: string }
  | Record<string, unknown>;

type McpToolResult = {
  content?: McpContent[];
  isError?: boolean;
  structuredContent?: unknown;
};

/**
 * Persistent Zoo MCP stdio client (KittyCAD/mcp). Used for execute / bbox /
 * multiview — real engine feedback for assemblies, not LLM guesswork.
 */
export class ZooMcpClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private readonly token: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly extraEnv: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly signal?: AbortSignal;

  constructor(opts: ZooMcpOptions) {
    this.token = opts.token.trim();
    this.command = opts.command ?? "uvx";
    this.args = opts.args ?? ["zoo-mcp"];
    this.extraEnv = opts.env ?? {};
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
    this.signal = opts.signal;
  }

  /** Bound every MCP request so a wedged server can't hold a caller open. */
  private requestOptions(): { timeout: number; signal?: AbortSignal } {
    return { timeout: this.timeoutMs, ...(this.signal ? { signal: this.signal } : {}) };
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.connecting = null;
    if (c) await c.close().catch(() => undefined);
  }

  private async ensure(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const transport = new StdioClientTransport({
        command: this.command,
        args: this.args,
        env: {
          ...process.env,
          ZOO_API_TOKEN: this.token,
          ...this.extraEnv,
        },
      });
      const client = new Client({ name: "foundry-zoo-mcp", version: "0.1.0" });
      await client.connect(transport, this.requestOptions());
      this.client = client;
      return client;
    })();
    try {
      return await this.connecting;
    } catch (err) {
      this.connecting = null;
      throw err;
    }
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const client = await this.ensure();
    const result = (await client.callTool(
      { name, arguments: args },
      undefined,
      this.requestOptions(),
    )) as McpToolResult;
    return result;
  }

  private textFrom(result: McpToolResult): string {
    const parts = result.content ?? [];
    return parts
      .map((block) =>
        block && typeof block === "object" && "type" in block && block.type === "text"
          ? String((block as { text?: unknown }).text ?? "")
          : "",
      )
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  private imageFrom(result: McpToolResult): Buffer | null {
    for (const block of result.content ?? []) {
      if (!block || typeof block !== "object") continue;
      if ((block as { type?: string }).type !== "image") continue;
      const data = (block as { data?: unknown }).data;
      if (typeof data !== "string" || !data) continue;
      return Buffer.from(data, "base64");
    }
    return null;
  }

  /** List the tools exposed by the connected MCP server. */
  async listTools(): Promise<CadResult<McpToolInfo[]>> {
    try {
      const client = await this.ensure();
      const result = await client.listTools(undefined, this.requestOptions());
      const tools = (result.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      return { ok: true, data: tools };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Call any MCP tool and return its raw text/image/structured output. */
  async callGenericTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CadResult<McpToolCallOutput>> {
    try {
      const result = await this.callTool(name, args);
      const text = this.textFrom(result);
      if (result.isError) {
        return { ok: false, error: text || `MCP tool ${name} failed` };
      }
      const images: McpToolCallOutput["images"] = [];
      for (const block of result.content ?? []) {
        if (!block || typeof block !== "object") continue;
        if ((block as { type?: string }).type !== "image") continue;
        const data = (block as { data?: unknown }).data;
        if (typeof data !== "string" || !data) continue;
        const mimeType = String((block as { mimeType?: unknown }).mimeType ?? "image/png");
        images.push({ mimeType, base64: data });
      }
      return {
        ok: true,
        data: { text, images, structured: result.structuredContent },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async executeKcl(input: {
    code?: string;
    projectDir?: string;
  }): Promise<CadResult<{ message: string }>> {
    try {
      const args: Record<string, unknown> = {};
      if (input.code) args.kcl_code = input.code;
      if (input.projectDir) args.kcl_path = input.projectDir;
      const result = await this.callTool("execute_kcl", args);
      const text = this.textFrom(result);
      // Tool returns tuple serialized as text, or structured content.
      if (result.isError) {
        return { ok: false, error: text || "Zoo MCP execute_kcl failed" };
      }
      const structured = result.structuredContent;
      if (Array.isArray(structured) && structured.length >= 2) {
        const ok = Boolean(structured[0]);
        const message = String(structured[1] ?? "");
        return ok
          ? { ok: true, data: { message } }
          : { ok: false, error: message || "KCL execution failed" };
      }
      // Text fallback: look for failure markers.
      if (/^false\b/i.test(text) || /failed to execute/i.test(text)) {
        return { ok: false, error: text };
      }
      return { ok: true, data: { message: text || "KCL code executed successfully" } };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async boundingBoxKcl(input: {
    code?: string;
    projectDir?: string;
    unit?: string;
  }): Promise<CadResult<CadBoundingBox>> {
    try {
      const args: Record<string, unknown> = {
        unit_length: input.unit ?? "mm",
      };
      if (input.code) args.kcl_code = input.code;
      if (input.projectDir) args.kcl_path = input.projectDir;
      const result = await this.callTool("calculate_bounding_box_kcl", args);
      const text = this.textFrom(result);
      if (result.isError) {
        return { ok: false, error: text || "Zoo MCP bounding box failed" };
      }
      const raw = result.structuredContent ?? tryParseJson(text);
      const box = normalizeBbox(raw);
      if (!box) {
        return {
          ok: false,
          error: text || "Zoo MCP returned no bounding box",
        };
      }
      return { ok: true, data: box };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async multiviewSnapshotKcl(input: {
    code?: string;
    projectDir?: string;
  }): Promise<CadResult<{ jpeg: Buffer }>> {
    try {
      const args: Record<string, unknown> = { zoom: true };
      if (input.code) args.kcl_code = input.code;
      if (input.projectDir) args.kcl_path = input.projectDir;
      const result = await this.callTool("multiview_snapshot_of_kcl", args);
      if (result.isError) {
        return {
          ok: false,
          error: this.textFrom(result) || "Zoo MCP multiview snapshot failed",
        };
      }
      const jpeg = this.imageFrom(result);
      if (!jpeg) {
        return {
          ok: false,
          error: this.textFrom(result) || "Zoo MCP returned no snapshot image",
        };
      }
      return { ok: true, data: { jpeg } };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Sometimes tools return Python-repr-ish dicts — try a light cleanup.
    try {
      const cleaned = text
        .replace(/'/g, '"')
        .replace(/\bNone\b/g, "null")
        .replace(/\bTrue\b/g, "true")
        .replace(/\bFalse\b/g, "false");
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function normalizeBbox(raw: unknown): CadBoundingBox | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const center = obj.center;
  const dimensions = obj.dimensions;
  if (!center || !dimensions || typeof center !== "object" || typeof dimensions !== "object") {
    return null;
  }
  const c = center as Record<string, unknown>;
  const d = dimensions as Record<string, unknown>;
  const cx = Number(c.x);
  const cy = Number(c.y);
  const cz = Number(c.z);
  const dx = Number(d.x);
  const dy = Number(d.y);
  const dz = Number(d.z);
  if (![cx, cy, cz, dx, dy, dz].every((n) => Number.isFinite(n))) return null;
  return {
    center: { x: cx, y: cy, z: cz },
    dimensions: { x: dx, y: dy, z: dz },
  };
}
