import { describe, expect, it } from "vitest";
import {
  CAD_LAB_DEFAULT_TIMEOUT_MS,
  cadLabEnabled,
  cadLabRequestSchema,
  cadLabTimeoutMs,
  parseEventLines,
} from "@/lib/cad-lab";

describe("cadLabEnabled", () => {
  it("is enabled outside production", () => {
    expect(cadLabEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(cadLabEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("is disabled in production unless CAD_LAB_ENABLED is set", () => {
    expect(cadLabEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(cadLabEnabled({ NODE_ENV: "production", CAD_LAB_ENABLED: "1" })).toBe(true);
    expect(cadLabEnabled({ NODE_ENV: "production", CAD_LAB_ENABLED: "true" })).toBe(true);
    expect(cadLabEnabled({ NODE_ENV: "production", CAD_LAB_ENABLED: "0" })).toBe(false);
  });
});

describe("cadLabTimeoutMs", () => {
  it("falls back to the default when unset or unusable", () => {
    expect(cadLabTimeoutMs(undefined)).toBe(CAD_LAB_DEFAULT_TIMEOUT_MS);
    expect(cadLabTimeoutMs("soon")).toBe(CAD_LAB_DEFAULT_TIMEOUT_MS);
    expect(cadLabTimeoutMs("0")).toBe(CAD_LAB_DEFAULT_TIMEOUT_MS);
  });

  it("clamps to a range that always answers", () => {
    expect(cadLabTimeoutMs("120000")).toBe(120_000);
    expect(cadLabTimeoutMs("1000")).toBe(30_000);
    expect(cadLabTimeoutMs("9999999999")).toBe(30 * 60_000);
  });
});

describe("parseEventLines", () => {
  it("keeps a partial trailing line for the next chunk", () => {
    const first = parseEventLines('{"type":"phase","phase":"generate"}\n{"type":"no');
    expect(first.events).toEqual([{ type: "phase", phase: "generate" }]);

    const second = parseEventLines(`${first.rest}te","text":"thinking"}\n`);
    expect(second.events).toEqual([{ type: "note", text: "thinking" }]);
    expect(second.rest).toBe("");
  });

  it("skips malformed lines so a run can still deliver its result", () => {
    const { events } = parseEventLines('not json\n\n{"type":"tick","elapsedMs":5000}\n');
    expect(events).toEqual([{ type: "tick", elapsedMs: 5000 }]);
  });
});

describe("cadLabRequestSchema", () => {
  it("accepts prompt-render requests", () => {
    const parsed = cadLabRequestSchema.parse({
      action: "zoo_prompt_render",
      prompt: "a 10mm cube",
    });
    expect(parsed.action).toBe("zoo_prompt_render");
    expect(cadLabRequestSchema.safeParse({ action: "zoo_prompt_render" }).success).toBe(false);
  });

  it("accepts zoo text-to-CAD prompts", () => {
    const parsed = cadLabRequestSchema.parse({
      action: "zoo_text_to_cad",
      prompt: "a 10mm cube",
    });
    expect(parsed.action).toBe("zoo_text_to_cad");
  });

  it("rejects empty prompts", () => {
    expect(cadLabRequestSchema.safeParse({ action: "zoo_text_to_cad", prompt: "  " }).success).toBe(
      false,
    );
  });

  it("requires KCL for iterate and MCP KCL actions", () => {
    expect(cadLabRequestSchema.safeParse({ action: "zoo_iterate", prompt: "wider" }).success).toBe(
      false,
    );
    expect(cadLabRequestSchema.safeParse({ action: "zoo_execute", kcl: "x = 1" }).success).toBe(
      true,
    );
  });

  it("only allows approved MCP runner commands", () => {
    expect(
      cadLabRequestSchema.safeParse({
        action: "mcp_list_tools",
        server: { command: "uvx", args: ["zoo-mcp"] },
      }).success,
    ).toBe(true);
    expect(
      cadLabRequestSchema.safeParse({
        action: "mcp_list_tools",
        server: { command: "bash", args: ["-c", "rm -rf /"] },
      }).success,
    ).toBe(false);
  });

  it("defaults MCP tool args to an empty object", () => {
    const parsed = cadLabRequestSchema.parse({
      action: "mcp_call_tool",
      server: { command: "uvx", args: ["zoo-mcp"] },
      tool: "execute_kcl",
    });
    expect(parsed.action === "mcp_call_tool" && parsed.toolArgs).toEqual({});
  });
});
