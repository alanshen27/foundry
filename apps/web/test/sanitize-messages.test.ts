import { describe, expect, it } from "vitest";
import type { ModelMessage, UIMessage } from "ai";
import {
  pruneEmptyAssistantMessages,
  sanitizeUiMessagesForModel,
  stripOrphanToolCalls,
  stripProviderExecutedToolParts,
} from "@/lib/copilot/messages";

describe("sanitizeUiMessagesForModel", () => {
  it("keeps completed tool parts and drops incomplete ones", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Working…" },
          {
            type: "tool-text_to_cad",
            toolCallId: "call_incomplete",
            state: "input-available",
            input: { prompt: "box" },
          },
          {
            type: "tool-text_to_cad",
            toolCallId: "call_done",
            state: "output-available",
            input: { prompt: "box" },
            output: { script: "x = 1" },
          },
        ],
      },
    ] as unknown as UIMessage[];

    const sanitized = sanitizeUiMessagesForModel(messages);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0]!.parts).toHaveLength(2);
    expect(sanitized[0]!.parts.map((p) => ("toolCallId" in p ? p.toolCallId : p.type))).toEqual([
      "text",
      "call_done",
    ]);
  });

  it("JSON-clones tool outputs so Date fields become strings", () => {
    const createdAt = new Date("2026-01-15T12:00:00.000Z");
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-get_project_state",
            toolCallId: "call_state",
            state: "output-available",
            input: {},
            output: {
              validationChecks: [{ id: "c1", createdAt, updatedAt: createdAt }],
            },
          },
        ],
      },
    ] as unknown as UIMessage[];

    const sanitized = sanitizeUiMessagesForModel(messages);
    const part = sanitized[0]!.parts[0] as {
      output: { validationChecks: { createdAt: unknown; updatedAt: unknown }[] };
    };
    expect(part.output.validationChecks[0]!.createdAt).toBe("2026-01-15T12:00:00.000Z");
    expect(part.output.validationChecks[0]!.updatedAt).toBe("2026-01-15T12:00:00.000Z");
  });

  it("drops reasoning parts that would replay as stale item references", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "reasoning",
            text: "Thinking about the enclosure…",
            providerMetadata: { openai: { itemId: "rs_0ec98f8d77f3f58e" } },
          },
          { type: "text", text: "Here's the plan." },
        ],
      },
    ] as unknown as UIMessage[];

    const sanitized = sanitizeUiMessagesForModel(messages);
    expect(sanitized[0]!.parts.map((p) => p.type)).toEqual(["text"]);
  });

  it("drops assistant messages left with nothing but reasoning", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "reasoning", text: "…" }],
      },
    ] as unknown as UIMessage[];

    expect(sanitizeUiMessagesForModel(messages)).toEqual([]);
  });

  it("drops assistant messages that only had incomplete tools", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-save_cad_script",
            toolCallId: "call_orphan",
            state: "approval-requested",
            input: { script: "x = 1" },
          },
        ],
      },
    ] as unknown as UIMessage[];

    expect(sanitizeUiMessagesForModel(messages)).toEqual([]);
  });
});

describe("stripProviderExecutedToolParts", () => {
  it("drops web_search results but keeps local tool calls", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Found parts." },
          {
            type: "tool-web_search",
            toolCallId: "ws_123",
            state: "output-available",
            input: { query: "esp32" },
            output: { results: [] },
          },
          {
            type: "tool-add_components",
            toolCallId: "call_bom",
            state: "output-available",
            input: {},
            output: { created: 3 },
          },
        ],
      },
    ] as unknown as UIMessage[];

    const stripped = stripProviderExecutedToolParts(messages);
    expect(stripped[0]!.parts.map((p) => p.type)).toEqual(["text", "tool-add_components"]);
  });
});

describe("pruneEmptyAssistantMessages", () => {
  it("removes empty Working placeholders", () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "@AI hi" }] },
      { id: "a1", role: "assistant", parts: [] },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "done" }] },
    ] as unknown as UIMessage[];
    expect(pruneEmptyAssistantMessages(messages).map((m) => m.id)).toEqual(["u1", "a2"]);
  });
});

describe("stripOrphanToolCalls", () => {
  it("removes tool-calls without matching results", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "hi" },
          {
            type: "tool-call",
            toolCallId: "call_missing",
            toolName: "text_to_cad",
            input: {},
          },
          {
            type: "tool-call",
            toolCallId: "call_ok",
            toolName: "text_to_cad",
            input: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_ok",
            toolName: "text_to_cad",
            output: { type: "json", value: { ok: true } },
          },
        ],
      },
    ] as ModelMessage[];

    const cleaned = stripOrphanToolCalls(messages);
    const assistant = cleaned[0]!;
    expect(assistant.role).toBe("assistant");
    expect(Array.isArray(assistant.content) ? assistant.content : []).toEqual([
      { type: "text", text: "hi" },
      {
        type: "tool-call",
        toolCallId: "call_ok",
        toolName: "text_to_cad",
        input: {},
      },
    ]);
  });
});
