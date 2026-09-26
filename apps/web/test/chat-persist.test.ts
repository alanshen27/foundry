import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage, UIMessageChunk } from "ai";
import { ASSISTANT_CANCELLED_TEXT, CANCELLED_TOOL_ERROR_TEXT } from "@/lib/copilot/messages";

type Row = { id: string; role: string; parts: unknown; createdAt: Date };
type CreateManyArgs = { data: Row[]; skipDuplicates?: boolean };
type FindManyArgs = { take?: number; orderBy?: unknown; where?: { id?: { in: string[] } } };

const createMany = vi.fn(async (_args: CreateManyArgs) => ({ count: 0 }));
const findMany = vi.fn(async (_args: FindManyArgs): Promise<Row[]> => []);
const deleteMany = vi.fn(async () => ({ count: 0 }));
const updateMany = vi.fn(
  async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
    count: 1,
  }),
);
const runFindUnique = vi.fn(
  async (): Promise<{
    status?: string;
    error?: string | null;
    projectId?: string;
    channelId?: string;
  } | null> => null,
);
const eventFindMany = vi.fn(async (): Promise<{ chunk: UIMessageChunk }[]> => []);
const transaction = vi.fn(async (ops: unknown[]) => Promise.all(ops));

vi.mock("@foundry/db", () => ({
  prisma: {
    chatMessage: { createMany, findMany, deleteMany, updateMany },
    chatRun: { findUnique: runFindUnique },
    chatRunEvent: { findMany: eventFindMany },
    $transaction: transaction,
  },
}));

const {
  CHAT_HISTORY_LIMIT,
  loadChannelHistory,
  saveNewMessages,
  persistRunMessages,
  messagePartsScore,
  persistCancelledRunFromEvents,
  checkpointRunMessages,
  rebuildUiMessagesFromRunEvents,
} = await import("@/server/chat-run/persist");

const scope = { projectId: "p1", branchId: "b1", channelId: "c1" };

function message(id: string, role: UIMessage["role"], text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text }] } as UIMessage;
}

function writtenRows(): Row[] {
  const call = createMany.mock.calls.at(-1);
  if (!call) throw new Error("createMany was never called");
  return call[0].data;
}

function row(index: number): Row {
  const value = writtenRows()[index];
  if (!value) throw new Error(`no row written at index ${index}`);
  return value;
}

beforeEach(() => {
  createMany.mockClear();
  findMany.mockClear();
  deleteMany.mockClear();
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  runFindUnique.mockReset().mockResolvedValue(null);
  eventFindMany.mockReset().mockResolvedValue([]);
  transaction.mockClear();
});

describe("messagePartsScore", () => {
  it("scores completed tool output higher than a bare text stub", () => {
    const rich = [
      { type: "text", text: "Working…" },
      {
        type: "tool-add_part_to_assembly",
        state: "output-available",
        output: { ok: true, placed: ["a", "b", "c"] },
      },
      { type: "text", text: "Assembled three parts." },
    ];
    const thin = [{ type: "text", text: "Working…" }];
    expect(messagePartsScore(rich)).toBeGreaterThan(messagePartsScore(thin));
  });
});

describe("persistRunMessages", () => {
  it("refuses to overwrite a richer DB row with a thinner client snapshot", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Here is the assembly." },
          {
            type: "tool-add_part_to_assembly",
            state: "output-available",
            output: { ok: true },
          },
        ],
        createdAt: new Date(),
      },
    ]);

    const count = await persistRunMessages(scope, [message("a1", "assistant", "Working…")]);

    expect(count).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("updates when the incoming parts are at least as rich", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Hi" }],
        createdAt: new Date(),
      },
    ]);

    const count = await persistRunMessages(scope, [
      message("a1", "assistant", "Hi — full answer with details."),
    ]);

    expect(count).toBe(1);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("keeps stopped tools terminal when a much longer stale draft arrives", async () => {
    const stopped = {
      type: "tool-extract_product_images",
      toolCallId: "tool1",
      input: { url: "https://example.com" },
      state: "output-error",
      errorText: CANCELLED_TOOL_ERROR_TEXT,
    };
    findMany.mockResolvedValueOnce([
      {
        id: "a1",
        role: "assistant",
        parts: [stopped, { type: "text", text: ASSISTANT_CANCELLED_TEXT }],
        createdAt: new Date(),
      },
    ]);
    await persistRunMessages(scope, [
      {
        id: "a1",
        role: "assistant",
        parts: [
          { ...stopped, state: "input-available", errorText: undefined },
          { type: "text", text: "Working ".repeat(1000) },
          {
            type: "tool-extract_product_images",
            toolCallId: "late",
            input: { url: "https://example.com/late" },
            state: "input-available",
          },
        ],
      } as UIMessage,
    ]);
    const parts = updateMany.mock.calls[0]![0].data.parts as Record<string, unknown>[];
    expect(parts.find((part) => part.toolCallId === "tool1")).toMatchObject({
      state: "output-error",
      errorText: CANCELLED_TOOL_ERROR_TEXT,
    });
    expect(parts.find((part) => part.toolCallId === "late")).toMatchObject({
      state: "output-error",
      errorText: CANCELLED_TOOL_ERROR_TEXT,
    });
    expect(parts).toContainEqual({ type: "text", text: ASSISTANT_CANCELLED_TEXT });
  });

  it("preserves completed tool results when cancellation replay saw an older pending call", async () => {
    const completed = {
      type: "tool-build",
      toolCallId: "tool1",
      input: {},
      state: "output-available",
      output: { createdId: "part1" },
    };
    findMany.mockResolvedValueOnce([
      { id: "a1", role: "assistant", parts: [completed], createdAt: new Date() },
    ]);
    await persistRunMessages(scope, [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            ...completed,
            state: "output-error",
            output: undefined,
            errorText: CANCELLED_TOOL_ERROR_TEXT,
          },
          { type: "text", text: ASSISTANT_CANCELLED_TEXT },
        ],
      } as UIMessage,
    ]);
    expect(updateMany.mock.calls[0]![0].data.parts).toContainEqual(completed);
  });

  it("accepts an actual completed result that raced with synthetic cancellation", async () => {
    const completed = {
      type: "tool-build",
      toolCallId: "tool1",
      input: {},
      state: "output-available",
      output: { createdId: "part1" },
    };
    findMany.mockResolvedValueOnce([
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            ...completed,
            state: "output-error",
            output: undefined,
            errorText: CANCELLED_TOOL_ERROR_TEXT,
          },
          { type: "text", text: ASSISTANT_CANCELLED_TEXT },
        ],
        createdAt: new Date(),
      },
    ]);
    await persistRunMessages(scope, [
      { id: "a1", role: "assistant", parts: [completed] } as UIMessage,
    ]);
    expect(updateMany.mock.calls[0]![0].data.parts).toContainEqual(completed);
    expect(updateMany.mock.calls[0]![0].data.parts).toContainEqual({
      type: "text",
      text: ASSISTANT_CANCELLED_TEXT,
    });
  });

  it("re-reads a concurrent cancellation before retrying a stale checkpoint", async () => {
    const pending = {
      type: "tool-build",
      toolCallId: "tool1",
      input: {},
      state: "input-available",
    };
    const stopped = { ...pending, state: "output-error", errorText: CANCELLED_TOOL_ERROR_TEXT };
    findMany.mockResolvedValueOnce([
      { id: "a1", role: "assistant", parts: [pending], createdAt: new Date() },
    ]);
    findMany.mockResolvedValueOnce([
      {
        id: "a1",
        role: "assistant",
        parts: [stopped, { type: "text", text: ASSISTANT_CANCELLED_TEXT }],
        createdAt: new Date(),
      },
    ]);
    updateMany.mockResolvedValueOnce({ count: 0 });
    const count = await persistRunMessages(scope, [
      {
        id: "a1",
        role: "assistant",
        parts: [pending, { type: "text", text: "Long draft ".repeat(100) }],
      } as UIMessage,
    ]);
    expect(count).toBe(1);
    expect(updateMany.mock.calls[0]![0].where).toMatchObject({
      ...scope,
      parts: { equals: [pending] },
    });
    expect(updateMany.mock.calls[1]![0].data.parts).toContainEqual(stopped);
    expect(updateMany.mock.calls[1]![0].data.parts).toContainEqual({
      type: "text",
      text: ASSISTANT_CANCELLED_TEXT,
    });
    expect(createMany.mock.calls[0]![0].skipDuplicates).toBe(true);
  });
});

describe("saveNewMessages", () => {
  it("never deletes existing history", async () => {
    await saveNewMessages(scope, [message("m1", "user", "hi")]);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("skips messages that are already stored instead of overwriting them", async () => {
    await saveNewMessages(scope, [message("m1", "user", "hi")]);
    const call = createMany.mock.calls.at(-1);
    expect(call?.[0].skipDuplicates).toBe(true);
  });

  it("writes the channel scope and role onto every row", async () => {
    await saveNewMessages(scope, [message("m1", "user", "hi"), message("m2", "assistant", "yo")]);
    expect(writtenRows()).toHaveLength(2);
    expect(row(0)).toMatchObject({ id: "m1", role: "user", authorUserId: null, ...scope });
    expect(row(1)).toMatchObject({ id: "m2", role: "assistant", authorUserId: null, ...scope });
  });

  it("persists authorUserId and replyToId from message metadata", async () => {
    await saveNewMessages(scope, [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "reply" }],
        metadata: { authorUserId: "u1", replyToId: "m0" },
      } as UIMessage,
    ]);
    expect(row(0)).toMatchObject({ authorUserId: "u1", replyToId: "m0" });
  });

  it("staggers createdAt so array order survives an orderBy on it", async () => {
    await saveNewMessages(scope, [
      message("m1", "user", "one"),
      message("m2", "assistant", "two"),
      message("m3", "user", "three"),
    ]);
    expect(row(0).createdAt.getTime()).toBeLessThan(row(1).createdAt.getTime());
    expect(row(1).createdAt.getTime()).toBeLessThan(row(2).createdAt.getTime());
  });

  it("drops empty placeholder messages and ones with no id", async () => {
    await saveNewMessages(scope, [
      message("m1", "user", "hi"),
      { id: "m2", role: "assistant", parts: [] } as unknown as UIMessage,
      { role: "assistant", parts: [{ type: "text", text: "no id" }] } as unknown as UIMessage,
    ]);
    expect(writtenRows().map((r) => r.id)).toEqual(["m1"]);
  });

  it("does not hit the database when there is nothing new to write", async () => {
    const count = await saveNewMessages(scope, []);
    expect(count).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe("loadChannelHistory", () => {
  it("takes the newest page and returns it oldest-first", async () => {
    const at = new Date();
    findMany.mockResolvedValueOnce([
      {
        id: "m3",
        role: "user",
        parts: [],
        createdAt: at,
        authorUserId: "u2",
        author: { id: "u2", name: "Bob", avatarUrl: null },
        replyToId: null,
        replyTo: null,
        editedAt: null,
        deletedAt: null,
        reactions: [],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [],
        createdAt: at,
        authorUserId: null,
        author: null,
        replyToId: null,
        replyTo: null,
        editedAt: null,
        deletedAt: null,
        reactions: [],
      },
      {
        id: "m1",
        role: "user",
        parts: [],
        createdAt: at,
        authorUserId: "u1",
        author: { id: "u1", name: "Ada", avatarUrl: null },
        replyToId: null,
        replyTo: null,
        editedAt: null,
        deletedAt: null,
        reactions: [{ emoji: "👍", userId: "u1" }],
      },
    ] as never);

    const rows = await loadChannelHistory("p1", "c1", "u1");

    const call = findMany.mock.calls.at(-1);
    expect(call?.[0].take).toBe(CHAT_HISTORY_LIMIT);
    expect(call?.[0].orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(rows.map((r) => r.id)).toEqual(["m1", "m2", "m3"]);
    expect(rows[0]).toMatchObject({
      authorUserId: "u1",
      authorName: "Ada",
      reactions: [{ emoji: "👍", count: 1, me: true }],
    });
    expect(rows[2]).toMatchObject({ authorUserId: "u2", authorName: "Bob" });
  });
});

describe("cancelled run history", () => {
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: "a1" },
    { type: "tool-input-available", toolCallId: "done", toolName: "build", input: {} },
    { type: "tool-output-available", toolCallId: "done", output: { createdId: "part1" } },
    {
      type: "tool-input-available",
      toolCallId: "pending",
      toolName: "extract_product_images",
      input: { url: "https://example.com" },
    },
  ];

  it("saves completed work and terminates unfinished tools before stop is announced", async () => {
    eventFindMany.mockResolvedValue(chunks.map((chunk) => ({ chunk })));
    await persistCancelledRunFromEvents({
      runId: "run1",
      scope,
      inputMessages: [message("u1", "user", "build")],
    });
    const parts = writtenRows().find((row) => row.id === "a1")!.parts as Record<string, unknown>[];
    expect(parts.find((part) => part.toolCallId === "done")).toMatchObject({
      state: "output-available",
      output: { createdId: "part1" },
    });
    expect(parts.find((part) => part.toolCallId === "pending")).toMatchObject({
      state: "output-error",
      errorText: CANCELLED_TOOL_ERROR_TEXT,
    });
    expect(parts).toContainEqual({ type: "text", text: ASSISTANT_CANCELLED_TEXT });
  });

  it("persists legacy streams without a message ID using a stable fallback", async () => {
    eventFindMany.mockResolvedValue([
      { chunk: { type: "start" } },
      ...chunks.slice(1).map((chunk) => ({ chunk })),
    ]);
    runFindUnique.mockResolvedValue({ projectId: "p1", channelId: "c1" });
    await persistCancelledRunFromEvents({
      runId: "legacy",
      scope,
      inputMessages: [message("u1", "user", "build")],
    });
    const assistant = writtenRows().find((row) => row.role === "assistant")!;
    expect(assistant.id).toBe("assistant_legacy");
    expect(assistant.parts).toContainEqual(
      expect.objectContaining({ toolCallId: "pending", state: "output-error" }),
    );
  });

  it("reuses the scoped client message ID matching a legacy stream's tool calls", async () => {
    eventFindMany.mockResolvedValue([
      { chunk: { type: "start" } },
      ...chunks.slice(1).map((chunk) => ({ chunk })),
    ]);
    runFindUnique.mockResolvedValue({ projectId: "p1", channelId: "c1" });
    const parts = [
      {
        type: "tool-build",
        toolCallId: "done",
        state: "output-available",
        input: {},
        output: { createdId: "part1" },
      },
      {
        type: "tool-extract_product_images",
        toolCallId: "pending",
        state: "input-available",
        input: { url: "https://example.com" },
      },
    ];
    findMany.mockResolvedValueOnce([
      { id: "client-id", role: "assistant", parts, createdAt: new Date() },
    ]);
    findMany.mockResolvedValueOnce([
      { id: "client-id", role: "assistant", parts, createdAt: new Date() },
    ]);
    await persistCancelledRunFromEvents({
      runId: "legacy",
      scope,
      inputMessages: [message("u1", "user", "build")],
    });
    expect(findMany.mock.calls[0]![0].where).toMatchObject({
      projectId: "p1",
      channelId: "c1",
      role: "assistant",
      deletedAt: null,
      parts: { array_contains: [{ toolCallId: "done" }] },
    });
    expect(writtenRows().find((row) => row.role === "assistant")!.id).toBe("client-id");
    expect(updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: "client-id" },
      data: {
        parts: expect.arrayContaining([
          expect.objectContaining({ toolCallId: "pending", state: "output-error" }),
        ]),
      },
    });
  });

  it("does not guess when legacy tool-call matches identify multiple saved rows", async () => {
    eventFindMany.mockResolvedValue([
      { chunk: { type: "start" } },
      ...chunks.slice(1).map((chunk) => ({ chunk })),
    ]);
    runFindUnique.mockResolvedValue({ projectId: "p1", channelId: "c1" });
    findMany.mockResolvedValueOnce(
      ["client-a", "client-b"].map((id) => ({
        id,
        role: "assistant",
        parts: [{ type: "tool-build", toolCallId: "done", state: "input-available", input: {} }],
        createdAt: new Date(),
      })),
    );
    const result = await rebuildUiMessagesFromRunEvents("legacy", [message("u1", "user", "build")]);
    expect(result.at(-1)!.id).toBe("assistant_legacy");
  });

  it("normalizes late checkpoints for a cancelled run", async () => {
    eventFindMany.mockResolvedValue(chunks.map((chunk) => ({ chunk })));
    runFindUnique.mockResolvedValue({ status: "CANCELLED", error: "cancelled" });
    const result = await checkpointRunMessages({
      runId: "run1",
      scope,
      inputMessages: [message("u1", "user", "build")],
    });
    expect(result.at(-1)!.parts).toContainEqual(
      expect.objectContaining({ toolCallId: "pending", state: "output-error" }),
    );
  });

  it("keeps successfully replayed work when a later chunk is malformed", async () => {
    eventFindMany.mockResolvedValue(
      [...chunks, { type: "text-delta", id: "missing", delta: "bad" } as UIMessageChunk].map(
        (chunk) => ({ chunk }),
      ),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await rebuildUiMessagesFromRunEvents("run1", [message("u1", "user", "build")]);
    expect(result.at(-1)!.parts).toContainEqual(
      expect.objectContaining({ toolCallId: "done", state: "output-available" }),
    );
    warn.mockRestore();
  });
});
