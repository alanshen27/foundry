import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceFindMany = vi.fn();
const workspaceUpdate = vi.fn();
const membershipFindUnique = vi.fn();
const auditCreate = vi.fn();
const createWorkspaceForOwner = vi.fn();

vi.mock("@foundry/db", () => ({
  prisma: {
    workspace: { findMany: workspaceFindMany, update: workspaceUpdate },
    workspaceMembership: { findUnique: membershipFindUnique },
    auditEvent: { create: auditCreate },
  },
}));
vi.mock("@/server/create-workspace", () => ({
  createWorkspaceForOwner: (...args: unknown[]) => createWorkspaceForOwner(...args),
}));

const { workspaceRouter } = await import("@/server/routers/workspace");
const user = {
  id: "u1",
  email: "builder@foundry.local",
  name: "Builder",
  avatarUrl: null,
  supabaseId: null,
  localPasswordHash: null,
  createdAt: new Date(),
};
const workspace = { id: "w1", name: "Workshop", slug: "original-address" };
const caller = workspaceRouter.createCaller({ user });

beforeEach(() => {
  vi.resetAllMocks();
  membershipFindUnique.mockResolvedValue({ role: "OWNER", grants: [] });
  workspaceUpdate.mockImplementation(({ data }) => Promise.resolve({ ...workspace, ...data }));
  auditCreate.mockResolvedValue({});
});

describe("inline workspace management", () => {
  it("renames with capability enforcement and an audit record while keeping existing URLs", async () => {
    await expect(caller.rename({ workspaceId: "w1", name: "  New workshop  " })).resolves.toEqual({
      ...workspace,
      name: "New workshop",
    });
    expect(membershipFindUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: "w1", userId: "u1" } },
      include: { grants: true },
    });
    expect(workspaceUpdate).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: { name: "New workshop" },
      select: { id: true, name: true, slug: true },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "WorkspaceRenamed",
        workspaceId: "w1",
        actorId: "u1",
        payload: { name: "New workshop" },
      }),
    });
  });

  it.each([
    null,
    { role: "MEMBER", grants: [] },
    { role: "GUEST", grants: [] },
    {
      role: "MEMBER",
      grants: [{ projectId: "p1", capability: "project.manage" }],
    },
  ])(
    "denies non-members and callers without workspace-wide management access",
    async (membership) => {
      membershipFindUnique.mockResolvedValue(membership);
      await expect(caller.rename({ workspaceId: "w1", name: "No" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(workspaceUpdate).not.toHaveBeenCalled();
      expect(auditCreate).not.toHaveBeenCalled();
    },
  );

  it("honors an explicit workspace-wide management grant", async () => {
    membershipFindUnique.mockResolvedValue({
      role: "MEMBER",
      grants: [{ projectId: null, capability: "project.manage" }],
    });
    await expect(caller.rename({ workspaceId: "w1", name: "Allowed" })).resolves.toMatchObject({
      name: "Allowed",
    });
  });

  it.each(["", "   ", "a".repeat(81)])(
    "rejects invalid names before accessing the database",
    async (name) => {
      await expect(caller.rename({ workspaceId: "w1", name })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(membershipFindUnique).not.toHaveBeenCalled();
      expect(workspaceUpdate).not.toHaveBeenCalled();
    },
  );

  it("rejects unauthenticated requests", async () => {
    await expect(
      workspaceRouter.createCaller({ user: null }).rename({ workspaceId: "w1", name: "No" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(workspaceUpdate).not.toHaveBeenCalled();
  });

  it("returns management permission without exposing membership grants", async () => {
    workspaceFindMany.mockResolvedValue([
      { ...workspace, memberships: [{ role: "OWNER", grants: [] }] },
      { ...workspace, id: "w2", memberships: [{ role: "MEMBER", grants: [] }] },
      {
        ...workspace,
        id: "w3",
        memberships: [{ role: "MEMBER", grants: [{ capability: "project.manage" }] }],
      },
    ]);
    const result = await caller.list();
    expect(result.map((row) => row.canManage)).toEqual([true, false, true]);
    expect(result.every((row) => !("memberships" in row))).toBe(true);
    expect(workspaceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberships: { some: { userId: "u1" } } },
        include: expect.objectContaining({
          memberships: {
            where: { userId: "u1" },
            select: {
              role: true,
              grants: { where: { projectId: null }, select: { capability: true } },
            },
          },
        }),
      }),
    );
  });

  it("trims new workspace names and rejects blank submissions", async () => {
    createWorkspaceForOwner.mockResolvedValue(workspace);
    await caller.create({ name: "  Workshop  " });
    expect(createWorkspaceForOwner).toHaveBeenCalledWith({ userId: "u1", name: "Workshop" });
    await expect(caller.create({ name: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createWorkspaceForOwner).toHaveBeenCalledTimes(1);
  });
});
