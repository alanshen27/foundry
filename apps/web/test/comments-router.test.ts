import { beforeEach, describe, expect, it, vi } from "vitest";

const requireProjectCapability = vi.fn();
const recordAudit = vi.fn();

const commentFindMany = vi.fn();
const commentFindUnique = vi.fn();
const commentCreate = vi.fn();
const commentUpdate = vi.fn();
const commentDelete = vi.fn();
const userFindMany = vi.fn();

vi.mock("../server/access", () => ({
  requireProjectCapability: (...args: unknown[]) => requireProjectCapability(...args),
}));

vi.mock("../server/audit", () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...args),
}));

vi.mock("@foundry/db", () => ({
  prisma: {
    viewportComment: {
      findMany: (...args: unknown[]) => commentFindMany(...args),
      findUnique: (...args: unknown[]) => commentFindUnique(...args),
      create: (...args: unknown[]) => commentCreate(...args),
      update: (...args: unknown[]) => commentUpdate(...args),
      delete: (...args: unknown[]) => commentDelete(...args),
    },
    user: { findMany: (...args: unknown[]) => userFindMany(...args) },
  },
}));

const { commentsRouter } = await import("../server/routers/comments");

const user = {
  id: "user1",
  email: "builder@foundry.local",
  name: "Builder",
  avatarUrl: null,
  supabaseId: null,
  localPasswordHash: null,
  createdAt: new Date(),
};

const project = { id: "proj1", workspaceId: "ws1" };

beforeEach(() => {
  requireProjectCapability.mockReset().mockResolvedValue({ project });
  recordAudit.mockReset().mockResolvedValue(undefined);
  commentFindMany.mockReset().mockResolvedValue([]);
  commentFindUnique.mockReset();
  commentCreate.mockReset().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "c1",
    ...data,
  }));
  commentUpdate.mockReset().mockResolvedValue({ id: "c1" });
  commentDelete.mockReset().mockResolvedValue({});
  userFindMany.mockReset().mockResolvedValue([{ id: "user1", name: "Builder" }]);
});

describe("comments.list", () => {
  it("hides resolved comments by default and attaches author names", async () => {
    commentFindMany.mockResolvedValue([
      { id: "c1", authorId: "user1", x: 1, y: 2, body: "check clearance" },
    ]);
    const caller = commentsRouter.createCaller({ user });
    const result = await caller.list({
      projectId: "proj1",
      branchId: "b1",
      surface: "pcb:board-1",
    });

    expect(commentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ surface: "pcb:board-1", resolvedAt: null }),
      }),
    );
    expect(result[0]!.authorName).toBe("Builder");
  });
});

describe("comments.add", () => {
  it("creates a pinned comment and records an audit event", async () => {
    const caller = commentsRouter.createCaller({ user });
    const result = await caller.add({
      projectId: "proj1",
      branchId: "b1",
      surface: "cad:comp-1",
      x: 0.4,
      y: 0.6,
      body: "this fillet looks off",
    });

    expect(result.id).toBe("c1");
    expect(requireProjectCapability).toHaveBeenCalledWith("user1", "proj1", "project.read");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ViewportCommentCreated" }),
    );
  });
});

describe("comments.resolve", () => {
  it("stamps resolver and time", async () => {
    commentFindUnique.mockResolvedValue({
      id: "c1",
      projectId: "proj1",
      branchId: "b1",
      surface: "pcb:board-1",
      authorId: "user2",
    });
    const caller = commentsRouter.createCaller({ user });
    await caller.resolve({ id: "c1", resolved: true });

    expect(commentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resolvedById: "user1" }),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ViewportCommentResolved" }),
    );
  });
});

describe("comments.remove", () => {
  it("lets authors delete their own comment with project.read", async () => {
    commentFindUnique.mockResolvedValue({
      id: "c1",
      projectId: "proj1",
      branchId: "b1",
      surface: "pcb:board-1",
      authorId: "user1",
    });
    const caller = commentsRouter.createCaller({ user });
    await caller.remove({ id: "c1" });
    expect(requireProjectCapability).toHaveBeenCalledWith("user1", "proj1", "project.read");
    expect(commentDelete).toHaveBeenCalled();
  });

  it("requires project.manage to delete someone else's comment", async () => {
    commentFindUnique.mockResolvedValue({
      id: "c1",
      projectId: "proj1",
      branchId: "b1",
      surface: "pcb:board-1",
      authorId: "user2",
    });
    const caller = commentsRouter.createCaller({ user });
    await caller.remove({ id: "c1" });
    expect(requireProjectCapability).toHaveBeenCalledWith("user1", "proj1", "project.manage");
  });
});
