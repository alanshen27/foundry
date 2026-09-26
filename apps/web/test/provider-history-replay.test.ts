import { describe, expect, it } from "vitest";
import { convertToModelMessages, generateText, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { sanitizeUiMessagesForModel } from "@/lib/copilot/messages";

const history = [
  { id: "u", role: "user", parts: [{ type: "text", text: "Find a microphone for a recorder" }] },
  {
    id: "a",
    role: "assistant",
    parts: [
      { type: "reasoning", text: "", providerMetadata: { openai: { itemId: "rs_old" } } },
      {
        type: "tool-web_search",
        toolCallId: "ws_old",
        state: "output-available",
        providerExecuted: true,
        input: { query: "MEMS microphone" },
        output: {
          sources: [{ title: "Microphone datasheet", url: "https://example.com/mic.pdf" }],
        },
        callProviderMetadata: { openai: { itemId: "ws_old" } },
      },
    ],
  },
  { id: "next", role: "user", parts: [{ type: "text", text: "Continue" }] },
] as UIMessage[];

async function captureRequest(messages: UIMessage[]) {
  let body: any;
  const openai = createOpenAI({
    apiKey: "test-key",
    fetch: async (_url, options) => {
      body = JSON.parse(options!.body as string);
      return new Response(
        JSON.stringify({
          id: "resp_new",
          created_at: 1,
          model: "gpt-5.6",
          output: [
            {
              type: "message",
              id: "msg_new",
              role: "assistant",
              content: [{ type: "output_text", text: "Ready", annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  });
  const tools = { web_search: openai.tools.webSearch({}) };
  const result = await generateText({
    model: openai("gpt-5.6"),
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    maxRetries: 0,
  });
  expect(result.text).toBe("Ready");
  return body;
}

describe("actual OpenAI Responses request serialization", () => {
  it("proves metadata-only cleanup still replays the provider call ID", async () => {
    const partial = structuredClone(history);
    partial[1]!.parts = partial[1]!.parts.filter((part) => part.type !== "reasoning");
    delete (partial[1]!.parts[0] as any).callProviderMetadata;
    const body = await captureRequest(partial);
    expect(body.input).toContainEqual({ type: "item_reference", id: "ws_old" });
  });
  it("continues after stopped search without orphan provider or reasoning items", async () => {
    const original = structuredClone(history);
    const body = await captureRequest(sanitizeUiMessagesForModel(history));
    expect(
      body.input.some((item: any) =>
        ["item_reference", "reasoning", "web_search_call"].includes(item.type),
      ),
    ).toBe(false);
    expect(JSON.stringify(body.input)).toContain("https://example.com/mic.pdf");
    expect(JSON.stringify(body.input)).toContain("Continue");
    expect(history).toEqual(original);
  });
  it("also handles dynamic and older unflagged provider calls", async () => {
    for (const part of [
      { ...history[1]!.parts[1], providerExecuted: undefined },
      { ...history[1]!.parts[1], type: "dynamic-tool", toolName: "web_search" },
      { ...history[1]!.parts[1], type: "dynamic-tool", toolName: "other_provider_tool" },
    ]) {
      const body = await captureRequest(
        sanitizeUiMessagesForModel([
          history[0]!,
          { ...history[1]!, parts: [part] } as UIMessage,
          history[2]!,
        ]),
      );
      expect(body.input.some((item: any) => item.type === "item_reference")).toBe(false);
      expect(JSON.stringify(body.input)).toContain("https://example.com/mic.pdf");
    }
  });
  it("keeps local mutation tools as paired calls and outputs", async () => {
    const messages = sanitizeUiMessagesForModel([
      {
        id: "a",
        role: "assistant",
        parts: [
          {
            type: "tool-save_circuit",
            toolCallId: "local_call",
            state: "output-available",
            input: { parts: [] },
            output: { saved: true },
          },
        ],
      } as UIMessage,
    ]);
    const body = await captureRequest(messages);
    expect(body.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call",
          call_id: "local_call",
          name: "save_circuit",
        }),
        expect.objectContaining({ type: "function_call_output", call_id: "local_call" }),
      ]),
    );
  });
});
