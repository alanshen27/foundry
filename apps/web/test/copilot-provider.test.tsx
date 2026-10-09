// @vitest-environment jsdom
/**
 * The copilot provider owns the rules around sending: who can send while a run
 * is in flight, what happens when the server refuses, how channels switch.
 * These run the real `useChat` and the real transport against a fake
 * `/api/ai/chat`, so what is tested is what ships.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTrpcMock, type TrpcMock } from "./utils/trpc-mock";
import type * as Realtime from "@foundry/realtime";
import type { UIMessageChunk } from "ai";

let mock: TrpcMock;
vi.mock("@/lib/trpc", () => ({
  get trpc() {
    return mock.trpc;
  },
}));

const broadcastSubscribers = new Map<
  string,
  (message: { event: string; payload: unknown }) => void
>();
vi.mock("@foundry/realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof Realtime>();
  return {
    ...actual,
    createOffBroadcastPort: () => ({
      subscribe: (
        channel: string,
        onMessage: (message: { event: string; payload: unknown }) => void,
      ) => {
        broadcastSubscribers.set(channel, onMessage);
        return { leave: () => broadcastSubscribers.delete(channel) };
      },
    }),
  };
});

const { CopilotProvider, useCopilot } = await import("@/components/copilot/copilot-provider");

type ChatPost = {
  projectId: string;
  branchId: string;
  channelId: string;
  messages: { parts: { text?: string }[] }[];
};
let chatResponses: (() => Response)[] = [];
let streamResponses: Response[] = [];
const posts: ChatPost[] = [];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function Harness() {
  const copilot = useCopilot();
  return (
    <div>
      <p data-testid="busy">{String(copilot.busy)}</p>
      <p data-testid="channel">{copilot.activeChannelId}</p>
      <p data-testid="channels">{copilot.channels.map((c) => c.name).join(",")}</p>
      <ul>
        {copilot.messages.map((m) => (
          <li key={m.id} data-role={m.role}>
            {m.parts.map((p) => ("text" in p ? p.text : "")).join("")}
          </li>
        ))}
      </ul>
      <button onClick={() => copilot.send("Ordering the parts on Friday")}>note</button>
      <button onClick={() => copilot.send("@AI swap the battery for a 1200 mAh cell")}>ask</button>
      <button onClick={() => void copilot.createChannel("enclosure")}>new channel</button>
      <button onClick={() => void copilot.deleteChannel(copilot.activeChannelId)}>
        delete channel
      </button>
      <button onClick={() => copilot.switchChannel("chan-2")}>switch</button>
      <button onClick={() => copilot.switchChannel("chan-1")}>back</button>
      <button onClick={() => copilot.setOpen(!copilot.open)}>toggle panel</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <CopilotProvider
      projectId="proj1"
      branchId="branch1"
      channels={[
        { id: "chan-1", name: "general", categoryId: null, sortOrder: 0 },
        { id: "chan-2", name: "firmware", categoryId: null, sortOrder: 1 },
      ]}
      categories={[]}
      defaultChannelId="chan-1"
      initialMessages={[]}
      viewer={{ id: "user1", name: "Builder" }}
    >
      <Harness />
    </CopilotProvider>,
  );
}

beforeEach(() => {
  mock = createTrpcMock();
  mock.query("chat.activeRun", { data: null });
  mock.mutation("chat.createChannel", (input) => ({
    id: "chan-new",
    name: (input as { name: string }).name,
    categoryId: null,
    sortOrder: 9,
  }));
  chatResponses = [];
  streamResponses = [];
  posts.length = 0;
  sessionStorage.clear();
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.includes("/api/ai/chat/runs/") && path.endsWith("/stream")) {
      const response = streamResponses.shift();
      if (!response) throw new Error("unexpected run stream");
      return response;
    }
    if (path.includes("/api/ai/chat/stream")) return new Response(null, { status: 204 });
    if (path.endsWith("/api/ai/chat") && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as ChatPost);
      const next = chatResponses.shift();
      return next ? next() : json(202, { runId: null, channelId: "chan-1", invoked: false });
    }
    throw new Error(`unexpected fetch ${path}`);
  }) as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

const lastText = (post: ChatPost) =>
  post.messages
    .at(-1)!
    .parts.map((p) => p.text ?? "")
    .join("");

describe("CopilotProvider sending", () => {
  it("refetches only what a committed project write changed", async () => {
    renderProvider();
    const notify = broadcastSubscribers.get("foundry:project:proj1:branch1");
    expect(notify).toBeDefined();
    const before = mock.invalidations.length;
    act(() => {
      notify!({
        event: "project-changed",
        payload: { changes: [{ kind: "design", design: "PCB" }] },
      });
      notify!({
        event: "project-changed",
        payload: { changes: [{ kind: "design", design: "PCB" }] },
      });
    });
    await waitFor(() =>
      expect(mock.invalidations.slice(before).map((i) => i.path)).toEqual([
        "design.get",
        "engineering.status",
      ]),
    );
    expect(mock.invalidations.at(-2)?.input).toEqual({
      projectId: "proj1",
      branchId: "branch1",
    });
    act(() => {
      notify!({
        event: "project-changed",
        payload: { changes: [{ kind: "code" }] },
      });
    });
    await waitFor(() => expect(mock.invalidations.at(-1)?.path).toBe("code"));
  });

  it("posts a plain note to the chat API with the project, branch and channel", async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("note"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      projectId: "proj1",
      branchId: "branch1",
      channelId: "chan-1",
    });
    expect(lastText(posts[0]!)).toBe("Ordering the parts on Friday");
    // A note is not a run: nothing locks.
    expect(screen.getByTestId("busy")).toHaveTextContent("false");
  });

  it("locks further @AI sends while a run is starting, but lets notes through", async () => {
    let release!: () => void;
    chatResponses.push(
      () =>
        // Hold the first @AI request open so the run is still starting.
        new Response(
          new ReadableStream({
            start(controller) {
              release = () => {
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify({ runId: null, invoked: false })),
                );
                controller.close();
              };
            },
          }),
          { status: 202 },
        ),
    );
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("ask"));
    await waitFor(() => expect(screen.getByTestId("busy")).toHaveTextContent("true"));

    await user.click(screen.getByText("ask"));
    await user.click(screen.getByText("note"));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.map(lastText)).toEqual([
      "@AI swap the battery for a 1200 mAh cell",
      "Ordering the parts on Friday",
    ]);
    await act(async () => release());
  });

  it("recovers from a rate-limit refusal: unlocks, and records why the turn failed", async () => {
    chatResponses.push(() =>
      json(429, {
        error: "You're starting copilot runs faster than the limit allows (5 per minute).",
        persisted: true,
      }),
    );
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("ask"));
    await waitFor(() =>
      expect(mock.mutationCalls.find((c) => c.path === "chat.persistMessages")).toBeDefined(),
    );
    const persisted = mock.mutationCalls.find((c) => c.path === "chat.persistMessages")!.input as {
      error: string;
    };
    expect(persisted.error).toContain("faster than the limit allows");
    await waitFor(() => expect(screen.getByTestId("busy")).toHaveTextContent("false"));
  });

  it("clears a stale workspace lock and retries the turn once", async () => {
    chatResponses.push(
      () =>
        json(409, {
          error: "This workspace is locked while another AI agent is editing it.",
        }),
      () => json(202, { runId: null, invoked: false }),
    );
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("ask"));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(mock.mutationCalls.map((c) => c.path)).toContain("chat.cancelActiveRun");
    expect(lastText(posts[1]!)).toBe("@AI swap the battery for a 1200 mAh cell");
    // Regression: the retry used to live in a .catch that useChat never
    // triggers, so a stale lock simply failed the turn.
    // The retry resends the same turn — it does not append a second copy.
    const userTurns = posts[1]!.messages.filter((m) =>
      m.parts.some((p) => p.text === "@AI swap the battery for a 1200 mAh cell"),
    );
    expect(userTurns).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId("busy")).toHaveTextContent("false"));
  });

  it("gives up after one retry and tells the user why", async () => {
    const locked = () =>
      json(409, {
        error: "This workspace is locked while another AI agent is editing it.",
      });
    chatResponses.push(locked, locked);
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("ask"));
    await waitFor(() => expect(posts).toHaveLength(2));
    await waitFor(() =>
      expect(mock.mutationCalls.find((c) => c.path === "chat.persistMessages")).toBeDefined(),
    );
    const persisted = mock.mutationCalls.find((c) => c.path === "chat.persistMessages")!.input as {
      error: string;
    };
    expect(persisted.error).toContain("workspace is locked");
    // No third attempt.
    await act(async () => new Promise((r) => setTimeout(r, 100)));
    expect(posts).toHaveLength(2);
    expect(screen.getByTestId("busy")).toHaveTextContent("false");
  });

  it("keeps the unsent turn in session storage in case the page reloads mid-request", async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("note"));
    const stored = Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) ?? "");
    expect(stored.some((v) => v.includes("Ordering the parts on Friday"))).toBe(true);
  });
});

describe("CopilotProvider channels", () => {
  it("creates a channel and switches to it", async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("new channel"));
    await waitFor(() => expect(screen.getByTestId("channel")).toHaveTextContent("chan-new"));
    expect(screen.getByTestId("channels")).toHaveTextContent("general,firmware,enclosure");
  });

  it("returns to the default channel after deleting the open one", async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("new channel"));
    await waitFor(() => expect(screen.getByTestId("channel")).toHaveTextContent("chan-new"));
    await user.click(screen.getByText("delete channel"));
    await waitFor(() => expect(screen.getByTestId("channel")).toHaveTextContent("chan-1"));
    expect(screen.getByTestId("channels")).not.toHaveTextContent("enclosure");
  });

  it("loads a channel's history before opening it", async () => {
    mock.clientQuery("chat.messages", () => [
      {
        id: "m1",
        role: "user",
        content: "",
        parts: [{ type: "text", text: "Pin 2 drives the LED" }],
        createdAt: new Date().toISOString(),
        authorUserId: "user2",
        authorName: "Teammate",
        authorAvatarUrl: null,
        metadata: null,
        reactions: [],
        editedAt: null,
      },
    ]);
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("switch"));
    await waitFor(() => expect(screen.getByTestId("channel")).toHaveTextContent("chan-2"));
    expect(await screen.findByText("Pin 2 drives the LED")).toBeInTheDocument();
  });

  it("stays put when a channel's history fails to load, rather than showing it empty", async () => {
    mock.clientQuery("chat.messages", () => {
      throw new Error("network down");
    });
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("switch"));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(screen.getByTestId("channel")).toHaveTextContent("chan-1");
  });
});

/** Real SSE bytes consumed by the SDK and production BackgroundChatTransport. */
function streamingReply() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  const emit = (chunk: UIMessageChunk) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  };
  chatResponses.push(() => json(202, { runId: "run-stream", invoked: true }));
  streamResponses.push(response);
  emit({ type: "start", messageId: "assistant-stream" });
  emit({ type: "text-start", id: "reply-text" });
  return {
    text: (delta: string) => emit({ type: "text-delta", id: "reply-text", delta }),
    finish: () => {
      emit({ type: "text-end", id: "reply-text" });
      emit({ type: "finish", finishReason: "stop" });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  };
}

describe("CopilotProvider transcript checkpoints", () => {
  it("streams without transcript storage I/O, then preserves the visible reply across page hide and reload", async () => {
    const reply = streamingReply();
    const user = userEvent.setup();
    const mounted = renderProvider();
    await user.click(screen.getByText("ask"));
    act(() => reply.text("Battery selected"));
    await screen.findByText("Battery selected");

    const reads = vi.spyOn(Storage.prototype, "getItem");
    const writes = vi.spyOn(Storage.prototype, "setItem");
    for (const delta of [" with", " charging", " protection"]) {
      act(() => reply.text(delta));
      await screen.findByText(new RegExp(`Battery selected.*${delta.trim()}$`));
    }
    // Shell updates also must not re-read/re-seed the transcript during render.
    await user.click(screen.getByText("toggle panel"));
    expect(reads.mock.calls.filter(([key]) => key.startsWith("foundry:chat-local:"))).toHaveLength(
      0,
    );
    expect(writes.mock.calls.filter(([key]) => key.startsWith("foundry:chat-local:"))).toHaveLength(
      0,
    );

    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(sessionStorage.getItem("foundry:chat-local:chan-1")).toContain(
      "Battery selected with charging protection",
    );
    mounted.unmount();
    act(() => reply.finish());
    renderProvider();
    expect(screen.getByText("Battery selected with charging protection")).toBeInTheDocument();
    expect(screen.getAllByText("@AI swap the battery for a 1200 mAh cell")).toHaveLength(1);
  });

  it("backs up the completed reply so a fresh provider can recover it without server history", async () => {
    const reply = streamingReply();
    const user = userEvent.setup();
    const mounted = renderProvider();
    await user.click(screen.getByText("ask"));
    act(() => {
      reply.text("The 1200 mAh cell fits.");
      reply.finish();
    });
    await waitFor(() => expect(screen.getByTestId("busy")).toHaveTextContent("false"));
    await waitFor(() =>
      expect(sessionStorage.getItem("foundry:chat-local:chan-1")).toContain(
        "The 1200 mAh cell fits.",
      ),
    );
    mounted.unmount();
    renderProvider();
    expect(screen.getByText("The 1200 mAh cell fits.")).toBeInTheDocument();
    expect(screen.getAllByText("@AI swap the battery for a 1200 mAh cell")).toHaveLength(1);
  });

  it("checkpoints the outgoing channel and restores its latest streamed reply when switching back", async () => {
    mock.clientQuery("chat.messages", () => []);
    const reply = streamingReply();
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText("ask"));
    act(() => reply.text("Checking the enclosure"));
    await screen.findByText("Checking the enclosure");
    await user.click(screen.getByText("switch"));
    await waitFor(() => expect(screen.getByTestId("channel")).toHaveTextContent("chan-2"));
    expect(screen.queryByText("Checking the enclosure")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("foundry:chat-local:chan-1")).toContain("Checking the enclosure");
    act(() => reply.finish());
    await user.click(screen.getByText("back"));
    await waitFor(() => expect(screen.getByTestId("channel")).toHaveTextContent("chan-1"));
    expect(screen.getByText("Checking the enclosure")).toBeInTheDocument();
    expect(screen.getAllByText("@AI swap the battery for a 1200 mAh cell")).toHaveLength(1);
  });
});
