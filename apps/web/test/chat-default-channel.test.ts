import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  chatChannelCategory: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
  },
  chatChannel: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  chatMessage: { updateMany: vi.fn() },
};

vi.mock("@foundry/db", () => ({ prisma: db }));

const { ensureDefaultChannel } = await import("@/server/chat");
const scope = { projectId: "project", branchId: "branch" };
const category = { id: "category", ...scope, name: "Text Channels" };
const channel = { id: "channel", ...scope, name: "General", categoryId: category.id };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  db.chatChannelCategory.findUnique.mockResolvedValue(category);
  db.chatChannelCategory.findUniqueOrThrow.mockResolvedValue(category);
  db.chatChannelCategory.create.mockResolvedValue(category);
  db.chatChannel.findUnique.mockResolvedValue(channel);
  db.chatChannel.findUniqueOrThrow.mockResolvedValue(channel);
  db.chatChannel.create.mockResolvedValue(channel);
  db.chatChannel.update.mockResolvedValue(channel);
  db.chatChannel.updateMany.mockResolvedValue({ count: 0 });
  db.chatMessage.updateMany.mockResolvedValue({ count: 0 });
});

describe("ensureDefaultChannel", () => {
  it("overlaps existing lookups and backfills while waiting for both migrations", async () => {
    const categoryRead = deferred<typeof category>();
    const channelRead = deferred<typeof channel>();
    const categoryBackfill = deferred<{ count: number }>();
    const messageBackfill = deferred<{ count: number }>();
    db.chatChannelCategory.findUnique.mockReturnValue(categoryRead.promise);
    db.chatChannel.findUnique.mockReturnValue(channelRead.promise);
    db.chatChannel.updateMany.mockReturnValue(categoryBackfill.promise);
    db.chatMessage.updateMany.mockReturnValue(messageBackfill.promise);

    const done = vi.fn();
    const pending = ensureDefaultChannel(scope.projectId, scope.branchId).then(done);
    expect(db.chatChannelCategory.findUnique).toHaveBeenCalledOnce();
    expect(db.chatChannel.findUnique).toHaveBeenCalledOnce();
    categoryRead.resolve(category);
    channelRead.resolve(channel);
    await vi.waitFor(() => {
      expect(db.chatChannel.updateMany).toHaveBeenCalledOnce();
      expect(db.chatMessage.updateMany).toHaveBeenCalledOnce();
    });
    expect(done).not.toHaveBeenCalled();
    categoryBackfill.resolve({ count: 1 });
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    messageBackfill.resolve({ count: 1 });
    await pending;

    expect(done).toHaveBeenCalledWith(channel);
    expect(db.chatChannel.update).not.toHaveBeenCalled();
    expect(db.chatChannel.create).not.toHaveBeenCalled();
    expect(db.chatChannel.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(db.chatChannelCategory.create).not.toHaveBeenCalled();
  });

  it("adopts legacy messages and uncategorized channels only in this branch", async () => {
    db.chatChannel.findUnique.mockResolvedValue({ ...channel, categoryId: null });

    await expect(ensureDefaultChannel(scope.projectId, scope.branchId)).resolves.toEqual(channel);

    expect(db.chatChannel.update).toHaveBeenCalledWith({
      where: { id: channel.id },
      data: { categoryId: category.id },
    });
    expect(db.chatChannel.updateMany).toHaveBeenCalledWith({
      where: { ...scope, categoryId: null },
      data: { categoryId: category.id },
    });
    expect(db.chatMessage.updateMany).toHaveBeenCalledWith({
      where: { ...scope, channelId: null },
      data: { channelId: channel.id },
    });
    expect(db.chatChannel.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("preserves an existing channel's chosen category", async () => {
    const moved = { ...channel, categoryId: "custom-category" };
    db.chatChannel.findUnique.mockResolvedValue(moved);

    await expect(ensureDefaultChannel(scope.projectId, scope.branchId)).resolves.toEqual(moved);
    expect(db.chatChannel.update).not.toHaveBeenCalled();
    expect(db.chatChannel.updateMany).toHaveBeenCalledWith({
      where: { ...scope, categoryId: null },
      data: { categoryId: category.id },
    });
  });

  it("creates a missing category even when the channel already exists", async () => {
    db.chatChannelCategory.findUnique.mockResolvedValue(null);
    db.chatChannel.findUnique.mockResolvedValue({ ...channel, categoryId: null });

    await expect(ensureDefaultChannel(scope.projectId, scope.branchId)).resolves.toEqual(channel);
    expect(db.chatChannelCategory.create).toHaveBeenCalledWith({
      data: { ...scope, name: "Text Channels", sortOrder: 0 },
    });
    expect(db.chatChannel.create).not.toHaveBeenCalled();
  });

  it("waits for a new category before creating its channel", async () => {
    const categoryCreate = deferred<typeof category>();
    db.chatChannelCategory.findUnique.mockResolvedValue(null);
    db.chatChannelCategory.create.mockReturnValue(categoryCreate.promise);
    db.chatChannel.findUnique.mockResolvedValue(null);

    const pending = ensureDefaultChannel(scope.projectId, scope.branchId);
    await vi.waitFor(() => expect(db.chatChannelCategory.create).toHaveBeenCalledOnce());
    expect(db.chatChannel.create).not.toHaveBeenCalled();
    categoryCreate.resolve(category);
    await expect(pending).resolves.toEqual(channel);
    expect(db.chatChannel.create).toHaveBeenCalledWith({
      data: { ...scope, name: "General", categoryId: category.id, sortOrder: 0 },
    });
  });

  it("adopts the winner when concurrent creates race on either unique constraint", async () => {
    db.chatChannelCategory.findUnique.mockResolvedValue(null);
    db.chatChannelCategory.create.mockRejectedValue({ code: "P2002" });
    db.chatChannel.findUnique.mockResolvedValue(null);
    db.chatChannel.create.mockRejectedValue({ code: "P2002" });

    await expect(ensureDefaultChannel(scope.projectId, scope.branchId)).resolves.toEqual(channel);
    expect(db.chatChannelCategory.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { projectId_branchId_name: { ...scope, name: "Text Channels" } },
    });
    expect(db.chatChannel.findUniqueOrThrow).toHaveBeenCalledOnce();
    expect(db.chatChannel.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { projectId_branchId_name: { ...scope, name: "General" } },
    });
    expect(db.chatMessage.updateMany).toHaveBeenCalledWith({
      where: { ...scope, channelId: null },
      data: { channelId: channel.id },
    });
  });

  it.each(["chatChannelCategory", "chatChannel"] as const)(
    "propagates a non-unique %s creation failure",
    async (model) => {
      const failure = new Error("Database unavailable");
      db[model].findUnique.mockResolvedValue(null);
      db[model].create.mockRejectedValue(failure);

      await expect(ensureDefaultChannel(scope.projectId, scope.branchId)).rejects.toBe(failure);
      expect(db[model].findUniqueOrThrow).not.toHaveBeenCalled();
    },
  );

  it.each(["chatChannel", "chatMessage"] as const)(
    "does not report success if the %s backfill fails",
    async (model) => {
      const failure = new Error("Backfill failed");
      db[model].updateMany.mockRejectedValue(failure);

      await expect(ensureDefaultChannel(scope.projectId, scope.branchId)).rejects.toBe(failure);
    },
  );
});
