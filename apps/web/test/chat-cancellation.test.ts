import { describe, expect, it, vi, afterEach } from "vitest";
import {
  convertToModelMessages,
  validateUIMessages,
  tool,
  type UIMessage,
  type InferUITools,
} from "ai";
import { z } from "zod";
import { BackgroundChatTransport } from "@/lib/copilot/background-chat-transport";
import {
  markCancelledAssistantMessages,
  CANCELLED_TOOL_ERROR_TEXT,
  ASSISTANT_CANCELLED_TEXT,
  mergeTranscriptPreferringUserTurns,
  sanitizeUiMessagesForModel,
  stripProviderExecutedToolParts,
} from "@/lib/copilot/messages";

const user: UIMessage = {
  id: "user",
  role: "user",
  parts: [{ type: "text", text: "@AI update the code and PCB" }],
};
const completed = {
  type: "tool-write_code_file",
  toolCallId: "saved",
  state: "output-available",
  input: { path: "saved.cpp", content: "void main() {}" },
  output: { ok: true, saved: "saved.cpp" },
};
const running = {
  type: "tool-write_code_file",
  toolCallId: "pending",
  state: "input-available",
  input: { path: "pending.cpp", content: "void main() {}" },
};
const assistant = (...parts: unknown[]): UIMessage =>
  ({ id: "assistant", role: "assistant", parts }) as UIMessage;

afterEach(() => vi.unstubAllGlobals());

describe("stopping in the middle of a tool", () => {
  it("retains completed changes and text while ending only this turn's incomplete tools", () => {
    const older = { ...assistant(running), id: "older" };
    const messages = [
      older,
      user,
      assistant({ type: "text", text: "Saved the first file." }, completed, running),
    ];
    const cancelled = markCancelledAssistantMessages(messages);
    expect(cancelled[0]).toBe(older);
    expect(cancelled[1]).toBe(user);
    expect(cancelled[2]!.parts[0]).toEqual({ type: "text", text: "Saved the first file." });
    expect(cancelled[2]!.parts[1]).toBe(completed);
    expect(cancelled[2]!.parts[2]).toMatchObject({
      toolCallId: "pending",
      state: "output-error",
      errorText: CANCELLED_TOOL_ERROR_TEXT,
    });
    expect(cancelled[2]!.parts.at(-1)).toEqual({ type: "text", text: ASSISTANT_CANCELLED_TEXT });
    expect(markCancelledAssistantMessages(cancelled)).toBe(cancelled);
    expect(messages[2]!.parts[2]).toBe(running);
  });

  it("ends every assistant step after the latest user and handles stop before any response", () => {
    const step = { ...assistant(running), id: "step-1" };
    const cancelled = markCancelledAssistantMessages([user, step, assistant(running)]);
    expect(
      cancelled
        .slice(1)
        .every((message) => message.parts.some((p) => "state" in p && p.state === "output-error")),
    ).toBe(true);
    expect(
      cancelled
        .flatMap((message) => message.parts)
        .filter((p) => p.type === "text" && p.text === ASSISTANT_CANCELLED_TEXT),
    ).toHaveLength(1);
    const early = markCancelledAssistantMessages([user]);
    expect(early).toHaveLength(2);
    expect(early[1]?.id).toBe("cancel_user");
    expect(markCancelledAssistantMessages([])).toEqual([]);
  });

  it.each(["input-streaming", "input-available", "approval-requested", "approval-responded"])(
    "replays cancelled %s inputs through actual SDK validation and conversion",
    async (state) => {
      const input = state === "input-streaming" ? { path: "partial.cpp" } : { path: 42 };
      const parts = [
        {
          ...running,
          input,
          state,
          ...(state.startsWith("approval-")
            ? {
                approval: {
                  id: "approval",
                  ...(state === "approval-responded" ? { approved: false } : {}),
                },
              }
            : {}),
        },
      ];
      const cancelled = markCancelledAssistantMessages([user, assistant(...parts)]);
      const tools = {
        write_code_file: tool({ inputSchema: z.object({ path: z.string(), content: z.string() }) }),
      };
      await expect(
        validateUIMessages<UIMessage<unknown, Record<string, never>, InferUITools<typeof tools>>>({
          messages: cancelled,
          tools,
        }),
      ).resolves.toHaveLength(2);
      const converted = await convertToModelMessages(sanitizeUiMessagesForModel(cancelled), {
        tools,
      });
      expect(converted.some((message) => message.role === "tool")).toBe(true);
      expect(JSON.stringify(converted)).toContain(CANCELLED_TOOL_ERROR_TEXT);
      if (state === "input-streaming")
        expect(cancelled[1]!.parts[0]).toMatchObject({ rawInput: input });
    },
  );

  it("handles dynamic tools and preserves completed failures and denials", async () => {
    const parts = [
      {
        type: "dynamic-tool",
        toolName: "plugin",
        toolCallId: "dynamic",
        state: "input-streaming",
        input: { partial: true },
      },
      {
        ...running,
        toolCallId: "failed",
        state: "output-error",
        errorText: "Engine rejected geometry",
      },
      {
        ...running,
        toolCallId: "denied",
        state: "output-denied",
        approval: { id: "deny", approved: false },
      },
    ];
    const cancelled = markCancelledAssistantMessages([user, assistant(...parts)]);
    expect(cancelled[1]!.parts[1]).toBe(parts[1]);
    expect(cancelled[1]!.parts[2]).toBe(parts[2]);
    await expect(validateUIMessages({ messages: cancelled })).resolves.toHaveLength(2);
  });

  it("keeps a cancelled provider-executed tool valid for SDK history replay", async () => {
    const cancelled = markCancelledAssistantMessages([
      user,
      assistant({
        type: "tool-web_search",
        toolCallId: "provider-search",
        state: "input-streaming",
        input: { query: "partial search" },
        providerExecuted: true,
      }),
    ]);
    await expect(validateUIMessages({ messages: cancelled, tools: {} })).resolves.toHaveLength(2);
    await expect(
      convertToModelMessages(sanitizeUiMessagesForModel(cancelled)),
    ).resolves.toBeDefined();
    expect(cancelled[1]?.parts[0]).toMatchObject({ providerExecuted: true, state: "output-error" });
  });
});

describe("terminal transcript reconciliation", () => {
  it("strips SDK7 call/result item references before converting provider tool history", async () => {
    const original = assistant({
      type: "tool-web_search",
      toolCallId: "search",
      state: "output-available",
      input: { query: "dimensions" },
      output: { results: [] },
      providerExecuted: true,
      callProviderMetadata: {
        openai: { itemId: "ws_expired_call", cacheHint: "keep" },
        other: { tag: "keep" },
      },
      resultProviderMetadata: { "openai.responses": { itemId: "ws_expired_result" } },
    });
    const sanitized = sanitizeUiMessagesForModel([user, original]);
    expect(sanitized[1]?.parts[0]).toMatchObject({ type: "text" });
    expect(sanitized[1]?.parts[0]).not.toHaveProperty("callProviderMetadata");
    expect(sanitized[1]?.parts[0]).not.toHaveProperty("resultProviderMetadata");
    const converted = await convertToModelMessages(sanitized);
    expect(JSON.stringify(converted)).not.toContain("ws_expired");
    expect(original.parts[0]).toHaveProperty(
      "callProviderMetadata.openai.itemId",
      "ws_expired_call",
    );
  });

  it("removes dynamic provider tools in the same retry path as static provider tools", () => {
    const messages = [
      assistant(
        {
          type: "dynamic-tool",
          toolName: "web_search",
          toolCallId: "search",
          state: "output-error",
          errorText: "expired",
          input: {},
        },
        {
          type: "dynamic-tool",
          toolName: "tool_search",
          toolCallId: "lookup",
          state: "output-error",
          errorText: "expired",
          input: {},
        },
        completed,
      ),
    ];
    expect(stripProviderExecutedToolParts(messages)[0]?.parts).toEqual([completed]);
  });

  it("never revives a cancelled server tool from a longer local draft", () => {
    const server = markCancelledAssistantMessages([user, assistant(completed, running)]);
    const local = [
      user,
      assistant({ type: "text", text: "Long draft explanation. ".repeat(30) }, completed, running),
    ];
    const merged = mergeTranscriptPreferringUserTurns(server, local);
    expect(merged[1]?.parts).toContainEqual(
      expect.objectContaining({ toolCallId: "pending", state: "output-error" }),
    );
    expect(merged[1]?.parts).toContainEqual({ type: "text", text: ASSISTANT_CANCELLED_TEXT });
    expect(merged[1]?.parts).toContain(completed);
    expect(
      merged[1]?.parts.some((part) => part.type === "text" && part.text.includes("Long draft")),
    ).toBe(true);
  });

  it("keeps local stopped tools against a stale checkpoint and restores server completed results", () => {
    const local = markCancelledAssistantMessages([user, assistant(running)]);
    const checkpoint = [user, assistant({ type: "text", text: "Checkpoint ".repeat(30) }, running)];
    expect(mergeTranscriptPreferringUserTurns(checkpoint, local)[1]?.parts).toContainEqual(
      expect.objectContaining({ state: "output-error" }),
    );
    const finished = { ...running, state: "output-available", output: { ok: true } };
    const merged = mergeTranscriptPreferringUserTurns([user, assistant(finished)], local);
    expect(merged[1]?.parts).toContain(finished);
    expect(merged[1]?.parts).not.toContainEqual(
      expect.objectContaining({ toolCallId: "pending", state: "input-available" }),
    );
  });
});

describe("enqueue cancellation acknowledgement", () => {
  const options = (signal: AbortSignal) => ({
    trigger: "submit-message" as const,
    chatId: "channel",
    messageId: undefined,
    messages: [user],
    abortSignal: signal,
  });

  it("converts a remote cancellation chunk into the SDK abort path for its exact run", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ runId: "remote-run" }))
      .mockResolvedValueOnce(
        new Response('data: {"type":"abort"}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const onRunCancelled = vi.fn();
    const transport = new BackgroundChatTransport({
      projectId: "p",
      branchId: "b",
      channelId: "c",
      onRunCancelled,
    });
    const stream = await transport.sendMessages(options(new AbortController().signal));
    await expect(stream.getReader().read()).rejects.toMatchObject({ name: "AbortError" });
    expect(onRunCancelled).toHaveBeenCalledWith("remote-run");
  });
  it("receives the precise accepted run id after stop during POST and never opens its stream", async () => {
    let acknowledge!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((resolve) => {
          acknowledge = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const onRunId = vi.fn();
    const transport = new BackgroundChatTransport({
      projectId: "p",
      branchId: "b",
      channelId: "c",
      onRunId,
    });
    const controller = new AbortController();
    const pending = transport.sendMessages(options(controller.signal));
    controller.abort();
    acknowledge(Response.json({ runId: "accepted-before-stop" }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(onRunId).toHaveBeenCalledWith("accepted-before-stop", true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty("signal");
  });

  it("does not enqueue an already stopped request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const transport = new BackgroundChatTransport({
      projectId: "p",
      branchId: "b",
      channelId: "c",
    });
    await expect(transport.sendMessages(options(AbortSignal.abort()))).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes cancellation to an accepted run's SSE and reports normal ownership", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ runId: "run" }))
      .mockResolvedValueOnce(
        new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }),
      );
    vi.stubGlobal("fetch", fetch);
    const onRunId = vi.fn();
    const controller = new AbortController();
    const transport = new BackgroundChatTransport({
      projectId: "p",
      branchId: "b",
      channelId: "c",
      onRunId,
    });
    const stream = await transport.sendMessages(options(controller.signal));
    expect(stream).toBeInstanceOf(ReadableStream);
    expect(onRunId).toHaveBeenCalledWith("run", false);
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/ai/chat/runs/run/stream",
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
