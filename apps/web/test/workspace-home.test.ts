import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const findUniqueOrThrow = vi.fn();
const createWorkspaceForOwner = vi.fn();
const getServerEnv = vi.fn(() => ({}));

vi.mock("@foundry/db", () => ({
  prisma: {
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

const { resolveWorkspaceHomePath } = await import("@/server/workspace-home");

beforeEach(() => {
  findMany.mockReset();
  findUniqueOrThrow.mockReset();
  createWorkspaceForOwner.mockReset();
  getServerEnv.mockReturnValue({});
});

describe("resolveWorkspaceHomePath", () => {
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
