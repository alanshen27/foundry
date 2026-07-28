import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";

type Row = { id: string; role: string; parts: unknown; createdAt: Date };
type CreateManyArgs = { data: Row[]; skipDuplicates?: boolean };
type FindManyArgs = { take?: number; orderBy?: unknown };

const createMany = vi.fn(async (_args: CreateManyArgs) => ({ count: 0 }));
const findMany = vi.fn(async (_args: FindManyArgs): Promise<Row[]> => []);
const deleteMany = vi.fn(async () => ({ count: 0 }));

vi.mock("@foundry/db", () => ({
  prisma: { chatMessage: { createMany, findMany, deleteMany } },
}));

const { CHAT_HISTORY_LIMIT, loadChannelHistory, saveNewMessages } =
  await import("@/server/chat-run/persist");

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
    expect(row(0)).toMatchObject({ id: "m1", role: "user", ...scope });
    expect(row(1)).toMatchObject({ id: "m2", role: "assistant", ...scope });
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
      { id: "m3", role: "user", parts: [], createdAt: at },
      { id: "m2", role: "assistant", parts: [], createdAt: at },
      { id: "m1", role: "user", parts: [], createdAt: at },
    ]);

    const rows = await loadChannelHistory("p1", "c1");

    const call = findMany.mock.calls.at(-1);
    expect(call?.[0].take).toBe(CHAT_HISTORY_LIMIT);
    expect(call?.[0].orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(rows.map((r) => r.id)).toEqual(["m1", "m2", "m3"]);
  });
});
