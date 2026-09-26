import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const projectFindFirst = vi.fn();
const findUniqueOrThrow = vi.fn();
const createWorkspaceForOwner = vi.fn();
const getServerEnv = vi.fn(() => ({}));

vi.mock("@foundry/db", () => ({
  prisma: {
    project: { findFirst: projectFindFirst },
    workspaceMembership: { findMany },
    user: { findUniqueOrThrow },
  },
}));

vi.mock("@foundry/config", () => ({
  getServerEnv: () => getServerEnv(),
}));

vi.mock("@/server/create-workspace", () => ({
  createWorkspaceForOwner: (...args: unknown[]) => createWorkspaceForOwner(...args),
  defaultWorkspaceName: (name: string) => `${name.trim() || "My"}'s Workspace`,
}));

const { resolveWorkspaceHomePath, resolveViewportHomePath } =
  await import("@/server/workspace-home");

beforeEach(() => {
  findMany.mockReset();
  projectFindFirst.mockReset();
  findUniqueOrThrow.mockReset();
  createWorkspaceForOwner.mockReset();
  getServerEnv.mockReturnValue({});
});

describe("resolveWorkspaceHomePath", () => {
  it("reopens the last project only through a current membership check", async () => {
    projectFindFirst.mockResolvedValue({ slug: "speaker", workspace: { slug: "studio" } });
    await expect(resolveViewportHomePath("user-1", "project-1")).resolves.toBe(
      "/w/studio/projects/speaker/engineer?view=assembly",
    );
    expect(projectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "project-1",
          status: "ACTIVE",
          workspace: { memberships: { some: { userId: "user-1" } } },
        }),
      }),
    );
  });
  it("falls back from a revoked project to the latest project in the user's home workspace", async () => {
    projectFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ slug: "new", workspace: { slug: "alpha" } });
    findMany.mockResolvedValue([{ workspace: { slug: "alpha" } }]);
    await expect(resolveViewportHomePath("user-1", "revoked")).resolves.toBe(
      "/w/alpha/projects/new/engineer?view=assembly",
    );
    expect(projectFindFirst.mock.calls[1]?.[0].where.workspace).toEqual({
      slug: "alpha",
      memberships: { some: { userId: "user-1" } },
    });
  });
  it("keeps empty accounts on their workspace so they can create a project", async () => {
    projectFindFirst.mockResolvedValue(null);
    findMany.mockResolvedValue([{ workspace: { slug: "alpha" } }]);
    await expect(resolveViewportHomePath("user-1")).resolves.toBe("/w/alpha");
  });
  it("returns the oldest membership workspace", async () => {
    findMany.mockResolvedValue([
      { workspace: { slug: "alpha", createdAt: new Date("2024-01-01") } },
      { workspace: { slug: "beta", createdAt: new Date("2024-02-01") } },
    ]);

    await expect(resolveWorkspaceHomePath("user-1")).resolves.toBe("/w/alpha");
    expect(createWorkspaceForOwner).not.toHaveBeenCalled();
  });

  it("creates a workspace when the user has none", async () => {
    findMany.mockResolvedValue([]);
    findUniqueOrThrow.mockResolvedValue({ id: "user-1", name: "Ada" });
    createWorkspaceForOwner.mockResolvedValue({ slug: "adas-workspace" });

    await expect(resolveWorkspaceHomePath("user-1")).resolves.toBe("/w/adas-workspace");
    expect(createWorkspaceForOwner).toHaveBeenCalledWith({
      userId: "user-1",
      name: "Ada's Workspace",
    });
  });

  it("prefers FOUNDRY_DEFAULT_WORKSPACE_SLUG when the user is a member", async () => {
    getServerEnv.mockReturnValue({ FOUNDRY_DEFAULT_WORKSPACE_SLUG: "beta" });
    findMany.mockResolvedValue([
      { workspace: { slug: "alpha", createdAt: new Date("2024-01-01") } },
      { workspace: { slug: "beta", createdAt: new Date("2024-02-01") } },
    ]);

    await expect(resolveWorkspaceHomePath("user-1")).resolves.toBe("/w/beta");
  });
});
