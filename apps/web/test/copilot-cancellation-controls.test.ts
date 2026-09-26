import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIMessage } from "ai";
import { CANCELLED_TOOL_ERROR_TEXT } from "@/lib/copilot/messages";
import type { BackgroundChatTransport } from "@/lib/copilot/background-chat-transport";

const cancel = vi.fn();
const persist = vi.fn();
const queryHistory = vi.fn();
const invalidate = vi.fn();
const sendMessage = vi.fn();
const stopStream = vi.fn();
const clearError = vi.fn();
let activeRun: { id: string } | null;
let messages: UIMessage[];
let callbacks: {
  transport: BackgroundChatTransport;
  onError: (error: Error) => void;
  onFinish: (result: { isError: boolean; isAbort: boolean }) => void;
};
const setMessages = vi.fn((update: UIMessage[] | ((previous: UIMessage[]) => UIMessage[])) => {
  messages = typeof update === "function" ? update(messages) : update;
});
const utils = {
  chat: { activeRun: { invalidate } },
  client: { chat: { messages: { query: (...args: unknown[]) => queryHistory(...args) } } },
};
const mutations = Object.fromEntries(
  [
    "editMessage",
    "deleteMessage",
    "toggleReaction",
    "createChannel",
    "deleteChannel",
    "createCategory",
    "deleteCategory",
  ].map((name) => [name, { useMutation: () => ({ mutateAsync: vi.fn() }) }]),
);
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => utils,
    chat: {
      ...mutations,
      cancelActiveRun: { useMutation: () => ({ mutateAsync: cancel }) },
      persistMessages: { useMutation: () => ({ mutateAsync: persist }) },
      activeRun: { useQuery: () => ({ data: activeRun, dataUpdatedAt: 1, isFetching: false }) },
    },
  },
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: (options: typeof callbacks) => {
    callbacks = options;
    return {
      messages,
      status: "ready",
      error: undefined,
      sendMessage,
      stop: stopStream,
      clearError,
      resumeStream: vi.fn(),
      setMessages,
    };
  },
}));
const { CopilotProvider, useCopilot } = await import("@/components/copilot/copilot-provider");
let controls: ReturnType<typeof useCopilot>;
function Probe() {
  controls = useCopilot();
  return null;
}
function renderProvider() {
  renderToStaticMarkup(
    createElement(CopilotProvider, {
      projectId: "project",
      branchId: "branch",
      defaultChannelId: "channel",
      channels: [{ id: "channel", name: "General", categoryId: null, sortOrder: 0 }],
      categories: [],
      initialMessages: messages,
      viewer: { id: "user", name: "User" },
      children: createElement(Probe),
    }),
  );
}
const tick = async () => {
  for (let i = 0; i < 16; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  activeRun = null;
  cancel.mockResolvedValue({ cancelled: true });
  persist.mockResolvedValue({ ok: true });
  queryHistory.mockResolvedValue([]);
  sendMessage.mockImplementation(() => new Promise(() => undefined));
  messages = [
    { id: "user", role: "user", parts: [{ type: "text", text: "@AI edit the PCB" }] },
    {
      id: "assistant",
      role: "assistant",
      parts: [{ type: "tool-save_pcb", toolCallId: "tool", state: "input-available", input: {} }],
    },
  ] as UIMessage[];
});
afterEach(() => vi.unstubAllGlobals());

describe("client stop and retry controls", () => {
  it("acknowledges a send only when it accepts the turn", () => {
    renderProvider();
    expect(controls.send("   ")).toBe(false);
    expect(controls.send("@AI initialize the project")).toBe(true);
    expect(controls.send("@AI duplicate initialization")).toBe(false);
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "@AI initialize the project" }),
    );
  });

  it("holds an immediate next AI send until the focused run cancellation settles", async () => {
    let acknowledgeStop!: () => void;
    cancel.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          acknowledgeStop = resolve;
        }),
    );
    activeRun = { id: "focused-run" };
    renderProvider();
    controls.stop();
    controls.send("continue @AI");
    expect(stopStream).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalled();
    acknowledgeStop();
    await tick();
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith({ projectId: "project", runId: "focused-run" });
  });

  it("waits for both a stopped POST acknowledgement and its exact cancellation before dispatching the next send", async () => {
    let acknowledgePost!: (response: Response) => void;
    let acknowledgeStop!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            acknowledgePost = resolve;
          }),
      ),
    );
    cancel.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          acknowledgeStop = resolve;
        }),
    );
    renderProvider();
    const controller = new AbortController();
    const old = callbacks.transport.sendMessages({
      trigger: "submit-message",
      chatId: "channel",
      messageId: undefined,
      messages,
      abortSignal: controller.signal,
    });
    controller.abort();
    controls.stop();
    controls.send("continue @AI");
    expect(sendMessage).not.toHaveBeenCalled();
    acknowledgePost(Response.json({ runId: "late-accepted-run" }));
    await tick();
    expect(cancel).toHaveBeenCalledWith({ projectId: "project", runId: "late-accepted-run" });
    expect(sendMessage).not.toHaveBeenCalled();
    acknowledgeStop();
    await expect(old).rejects.toMatchObject({ name: "AbortError" });
    await tick();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("surfaces cancellation rejection instead of dispatching into a still locked run or hanging", async () => {
    cancel.mockRejectedValueOnce(new Error("Network unavailable"));
    activeRun = { id: "focused-run" };
    renderProvider();
    controls.stop();
    controls.send("continue @AI");
    await tick();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(JSON.stringify(messages)).toContain("Could not confirm the stop");
    expect(persist).toHaveBeenCalledOnce();
  });
  it("cancels an old POST acknowledgement without stealing the next run's stop control", async () => {
    let acknowledgeOld!: (response: Response) => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            acknowledgeOld = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json({ runId: "new-run" }))
      .mockResolvedValueOnce(
        new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }),
      );
    vi.stubGlobal("fetch", fetch);
    renderProvider();
    const options = (signal: AbortSignal) => ({
      trigger: "submit-message" as const,
      chatId: "channel",
      messageId: undefined,
      messages,
      abortSignal: signal,
    });
    const oldController = new AbortController();
    const old = callbacks.transport.sendMessages(options(oldController.signal));
    oldController.abort();
    controls.stop();
    controls.send("continue @AI");
    await callbacks.transport.sendMessages(options(new AbortController().signal));
    acknowledgeOld(Response.json({ runId: "old-run" }));
    await expect(old).rejects.toMatchObject({ name: "AbortError" });
    const writesBeforeOldFinish = setMessages.mock.calls.length;
    callbacks.onFinish({ isError: false, isAbort: true });
    expect(setMessages).toHaveBeenCalledTimes(writesBeforeOldFinish);
    controls.stop();
    await tick();
    expect(cancel.mock.calls.map(([input]) => input)).toEqual([
      { projectId: "project", runId: "old-run" },
      { projectId: "project", runId: "new-run" },
    ]);
    expect(persist).not.toHaveBeenCalled();
  });

  it("clears an attached run's tools when another client stops it", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ runId: "attached-run" }))
      .mockResolvedValueOnce(
        new Response('data: {"type":"abort"}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    renderProvider();
    const stream = await callbacks.transport.sendMessages({
      trigger: "submit-message",
      chatId: "channel",
      messageId: undefined,
      messages,
      abortSignal: new AbortController().signal,
    });
    await expect(stream.getReader().read()).rejects.toMatchObject({ name: "AbortError" });
    callbacks.onFinish({ isError: false, isAbort: true });
    await tick();
    expect(messages[1]?.parts[0]).toMatchObject({
      state: "output-error",
      errorText: CANCELLED_TOOL_ERROR_TEXT,
    });
    expect(cancel).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
  it("stops exactly the focused run, keeps its cancelled tool visible, and does not stamp an abort as failure", async () => {
    activeRun = { id: "focused-run" };
    renderProvider();
    controls.stop();
    callbacks.onFinish({ isError: false, isAbort: true });
    await tick();
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith({ projectId: "project", runId: "focused-run" });
    expect(stopStream).toHaveBeenCalledOnce();
    expect(clearError).toHaveBeenCalledOnce();
    expect(messages[1]?.parts).toContainEqual(
      expect.objectContaining({ state: "output-error", errorText: CANCELLED_TOOL_ERROR_TEXT }),
    );
    expect(persist).not.toHaveBeenCalled();
    expect(JSON.stringify(messages)).not.toContain("Failed:");
  });

  it("never cancels the whole branch when stopped before enqueue acknowledges a run id", () => {
    renderProvider();
    controls.stop();
    expect(cancel).not.toHaveBeenCalled();
    expect(messages[1]?.parts[0]).toMatchObject({ state: "output-error" });
  });

  it("never lets a late failure history fetch stamp a newer send", async () => {
    let finishHistory!: (rows: unknown[]) => void;
    queryHistory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishHistory = resolve;
        }),
    );
    renderProvider();
    callbacks.onError(new Error("Old request failed"));
    controls.send("continue @AI");
    const countBeforeOldHistory = setMessages.mock.calls.length;
    finishHistory([]);
    await tick();
    expect(setMessages).toHaveBeenCalledTimes(countBeforeOldHistory);
    expect(persist).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("shows a lock rejection without cancelling another run or retrying mutations", async () => {
    sendMessage.mockRejectedValueOnce(new Error("Workspace is locked by another AI run"));
    renderProvider();
    controls.send("continue @AI");
    await tick();
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expect(JSON.stringify(messages)).toContain("Workspace is locked");
  });
});
