import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { readUIMessageStream, tool, type UIMessage, type UIMessageChunk } from "ai";
import { z } from "zod";

const state = vi.hoisted(() => ({
  run: {} as any,
  model: null as any,
  onLeaseRead: null as null | (() => void),
  tools: {} as any,
  events: [] as UIMessageChunk[],
  publishError: null as Error | null,
  persisted: [] as UIMessage[][],
  checkpointInputs: [] as UIMessage[][],
  finished: vi.fn(),
  listener: null as null | ((message: any) => void),
}));
vi.mock("@foundry/config", () => ({
  getServerEnv: () => ({ OPENAI_API_KEY: "test", AI_MODEL: "test" }),
}));
vi.mock("@foundry/db", () => ({
  prisma: {
    chatRun: {
      findUnique: async (args: any) => {
        if (args.select?.status) state.onLeaseRead?.();
        return { ...state.run };
      },
      updateMany: async ({ where, data }: any) => {
        const allowed = typeof where.status === "string" ? [where.status] : where.status?.in;
        if (allowed && !allowed.includes(state.run.status)) return { count: 0 };
        Object.assign(state.run, data);
        return { count: 1 };
      },
    },
  },
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () =>
    Object.assign(() => state.model, {
      tools: { webSearch: () => tool({ inputSchema: z.object({}) }) },
    }),
}));
vi.mock("@/server/ai/tools", () => ({
  buildProjectTools: () => state.tools,
  withToolLogging: (tools: unknown) => tools,
}));
vi.mock("@/server/app-origin", () => ({ appOrigin: () => "http://localhost" }));
vi.mock("@foundry/realtime", () => ({
  copilotBroadcastChannel: () => "channel",
  createSupabaseBroadcastPort: vi.fn(),
  createOffBroadcastPort: () => ({
    subscribe: (_: unknown, listener: (msg: any) => void) => {
      state.listener = listener;
      return { leave: vi.fn() };
    },
  }),
}));
vi.mock("@/server/chat-run/publish", () => ({
  maxRunEventSeq: async () => state.events.length,
  publishRunChunks: async (_run: string, events: { seq: number; chunk: UIMessageChunk }[]) => {
    if (state.publishError) throw state.publishError;
    state.events.push(...events.map((event) => event.chunk));
  },
  publishRunStarted: vi.fn(),
  publishRunFinished: (...args: unknown[]) => state.finished(...args),
}));
vi.mock("@/server/chat-run/persist", () => {
  const rebuild = async (_runId: string, input: UIMessage[]) => {
    let last: UIMessage | undefined;
    const chunks = [...state.events];
    for await (const message of readUIMessageStream({
      stream: new ReadableStream({
        start(c) {
          for (const chunk of chunks) c.enqueue(chunk);
          c.close();
        },
      }),
      terminateOnError: false,
    }))
      last = message;
    return last?.parts.length ? [...input, last] : input;
  };
  return {
    checkpointRunMessages: ({ runId, inputMessages }: any) => {
      state.checkpointInputs.push(inputMessages);
      return rebuild(runId, inputMessages);
    },
    rebuildUiMessagesFromRunEvents: rebuild,
    persistRunMessages: async (_scope: unknown, messages: UIMessage[]) => {
      state.persisted.push(messages);
    },
    persistFailedRunFromEvents: vi.fn().mockResolvedValue(1),
  };
});
import { executeChatRun } from "@/server/chat-run/execute";

const user: UIMessage = {
  id: "user",
  role: "user",
  parts: [{ type: "text", text: "Make the model" }],
};
const finish = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
} as const;
function modelWith(chunks: any[]) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          for (const chunk of chunks) c.enqueue(chunk);
          c.close();
        },
      }),
    }),
  });
}
beforeEach(() => {
  state.run = {
    id: "run",
    projectId: "project",
    branchId: "branch",
    channelId: "channel",
    actorId: "actor",
    status: "PENDING",
    inputMessages: [user],
  };
  state.events = [];
  state.publishError = null;
  state.persisted = [];
  state.checkpointInputs = [];
  state.tools = {};
  state.listener = null;
  state.onLeaseRead = null;
  state.finished.mockClear();
});

describe("chat run lifecycle with the real AI SDK", () => {
  it("aborts a silent tool on an asynchronous event-write failure and reports ERROR", async () => {
    let finishTool!: (value: string) => void;
    const execute = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishTool = resolve;
        }),
    );
    state.tools = { slow: tool({ inputSchema: z.object({}), execute }) };
    state.model = modelWith([
      { type: "tool-call", toolCallId: "slow-1", toolName: "slow", input: "{}" },
      { ...finish, finishReason: { unified: "tool-calls", raw: "tool_calls" } },
    ]);
    state.publishError = new Error("Event persistence unavailable");
    const running = executeChatRun("run");
    const rejection = expect(running).rejects.toThrow("Event persistence unavailable");
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await rejection;
    expect(state.run).toMatchObject({ status: "ERROR", error: "Event persistence unavailable" });
    expect(state.finished).toHaveBeenCalledWith(
      "run",
      "channel",
      "error",
      "Event persistence unavailable",
    );
    expect(state.finished.mock.calls.some((call) => call[2] === "cancelled")).toBe(false);
    finishTool("late result");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state.events).toEqual([]);
  });
  it("marks an error chunk ERROR instead of DONE and preserves the actual cause", async () => {
    state.model = modelWith([{ type: "error", error: new Error("Provider rejected the request") }]);
    await expect(executeChatRun("run")).rejects.toThrow("Provider rejected the request");
    expect(state.run).toMatchObject({ status: "ERROR", error: "Provider rejected the request" });
    expect(state.finished).toHaveBeenCalledWith(
      "run",
      "channel",
      "error",
      "Provider rejected the request",
    );
    expect(state.events.some((chunk) => chunk.type === "error")).toBe(false);
    expect(JSON.stringify(state.persisted)).toContain("Provider rejected the request");
  });
  it.each([
    "Item with id 'ws_old' not found",
    "Item 'ws_old' of type 'web_search_call' was provided without its required 'reasoning' item: 'rs_old'.",
  ])("recovers a provider history error before output: %s", async (providerError) => {
    let attempt = 0;
    const good = modelWith([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Continued." },
      { type: "text-end", id: "t" },
      finish,
    ]);
    state.model = new MockLanguageModelV4({
      doStream: async (options) => {
        if (++attempt === 1)
          return modelWith([{ type: "error", error: new Error(providerError) }]).doStream(options);
        return good.doStream(options);
      },
    });
    await executeChatRun("run");
    expect(attempt).toBe(2);
    expect(state.run.status).toBe("DONE");
    expect(state.events.some((chunk) => chunk.type === "error")).toBe(false);
    expect(JSON.stringify(state.persisted)).toContain("Continued.");
  });
  it("does not replay an attempt after it has already produced output", async () => {
    state.model = modelWith([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Started" },
      { type: "error", error: new Error("Item with id 'ws_old' not found") },
    ]);
    await expect(executeChatRun("run")).rejects.toThrow("not found");
    expect(state.model.doStreamCalls).toHaveLength(1);
    expect(state.run.status).toBe("ERROR");
  });
  it("stops immediately during a tool that ignores abort, then accepts a clean follow-up", async () => {
    let finishTool!: (value: string) => void;
    const execute = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishTool = resolve;
        }),
    );
    state.tools = { slow: tool({ inputSchema: z.object({}), execute }) };
    state.model = modelWith([
      { type: "tool-call", toolCallId: "slow-1", toolName: "slow", input: "{}" },
      { ...finish, finishReason: { unified: "tool-calls", raw: "tool_calls" } },
    ]);
    const running = executeChatRun("run");
    await vi.waitFor(() =>
      expect(state.events.some((chunk) => chunk.type === "tool-input-available")).toBe(true),
    );
    state.run.status = "CANCELLED";
    state.listener!({ event: "run-finished", payload: { runId: "run", status: "cancelled" } });
    await running;
    const cancelled = state.persisted.at(-1)!;
    expect(state.events.find((chunk) => chunk.type === "start")).toMatchObject({
      messageId: "assistant_run",
    });
    expect(cancelled.at(-1)?.id).toBe("assistant_run");
    expect(JSON.stringify(cancelled)).toContain("Stopped by user before this tool finished.");
    expect(state.run.status).toBe("CANCELLED");
    const stoppedCount = state.events.length;
    finishTool("late result");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state.events).toHaveLength(stoppedCount);
    state.run = {
      ...state.run,
      id: "next",
      status: "PENDING",
      inputMessages: [
        ...cancelled,
        { ...user, id: "next-user", parts: [{ type: "text", text: "Continue" }] },
      ],
    };
    state.events = [];
    state.model = modelWith([
      { type: "text-start", id: "next" },
      { type: "text-delta", id: "next", delta: "Ready to continue" },
      { type: "text-end", id: "next" },
      finish,
    ]);
    await executeChatRun("next");
    expect(state.run.status).toBe("DONE");
    expect(JSON.stringify(state.persisted.at(-1))).toContain("Ready to continue");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("preserves an externally failed run instead of relabeling lease loss as Stop", async () => {
    state.model = modelWith([]);
    state.onLeaseRead = () => {
      state.run.status = "ERROR";
      state.run.error = "The worker restarted";
    };
    await executeChatRun("run");
    expect(state.model.doStreamCalls).toHaveLength(0);
    expect(JSON.stringify(state.persisted.at(-1))).toContain("The worker restarted");
    expect(JSON.stringify(state.persisted.at(-1))).not.toContain("Stopped.");
    expect(state.finished).not.toHaveBeenCalled();
  });
  it("keeps search cards in saved/UI history while sending only reference text to the model", async () => {
    const search = {
      id: "old-assistant",
      role: "assistant",
      parts: [
        {
          type: "tool-web_search",
          toolCallId: "ws_old",
          state: "output-available",
          providerExecuted: true,
          input: { query: "example" },
          output: { sources: [{ url: "https://example.com" }] },
        },
      ],
    } as UIMessage;
    state.run.inputMessages = [user, search, { ...user, id: "continue" }];
    state.model = modelWith([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Continued" },
      { type: "text-end", id: "t" },
      finish,
    ]);
    await executeChatRun("run");
    expect(JSON.stringify(state.model.doStreamCalls[0].prompt)).toContain(
      "Earlier web_search result",
    );
    expect(state.checkpointInputs.length).toBeGreaterThan(0);
    for (const input of state.checkpointInputs) expect(input[1]).toEqual(search);
    expect(state.persisted.at(-1)?.[1]).toEqual(search);
  });
  it("terminalizes malformed input before stream setup", async () => {
    state.run.inputMessages = [{ bad: "history" }];
    await expect(executeChatRun("run")).rejects.toThrow();
    expect(state.run.status).toBe("ERROR");
    expect(state.finished).toHaveBeenCalledWith("run", "channel", "error", expect.any(String));
  });
});
