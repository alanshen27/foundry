import { describe, expect, it } from "vitest";
import { cadLabEnabled, cadLabRequestSchema } from "@/lib/cad-lab";

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

describe("cadLabRequestSchema", () => {
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
