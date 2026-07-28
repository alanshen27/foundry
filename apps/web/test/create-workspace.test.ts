import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();
const auditCreate = vi.fn();

vi.mock("@foundry/db", () => ({
  prisma: {
    workspace: { findUnique, create },
    auditEvent: { create: auditCreate },
  },
}));

const { createWorkspaceForOwner, defaultWorkspaceName } = await import(
  "@/server/create-workspace"
);

beforeEach(() => {
  findUnique.mockReset();
  create.mockReset();
  auditCreate.mockReset();
});

describe("defaultWorkspaceName", () => {
  it("uses the user's name", () => {
    expect(defaultWorkspaceName("Ada")).toBe("Ada's Workspace");
  });

  it("falls back when the name is blank", () => {
    expect(defaultWorkspaceName("   ")).toBe("My Workspace");
  });

  it("trims surrounding whitespace", () => {
    expect(defaultWorkspaceName("  Ada  ")).toBe("Ada's Workspace");
  });

  it("stays within the 80-character workspace name limit", () => {
    const name = "A".repeat(100);
    expect(defaultWorkspaceName(name).length).toBe(80);
  });
});

describe("createWorkspaceForOwner", () => {
  it("creates an OWNER membership and audit event with a unique slug", async () => {
    findUnique
      .mockResolvedValueOnce({ id: "taken" })
      .mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({
      id: "ws1",
      name: "Ada's Workspace",
      slug: "ada-s-workspace-2",
    });
    auditCreate.mockResolvedValueOnce({});

    const workspace = await createWorkspaceForOwner({
      userId: "user1",
      name: "Ada's Workspace",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        name: "Ada's Workspace",
        slug: "ada-s-workspace-2",
        createdById: "user1",
        memberships: { create: { userId: "user1", role: "OWNER" } },
      },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "WorkspaceCreated",
        workspaceId: "ws1",
        actorId: "user1",
      }),
    });
    expect(workspace.slug).toBe("ada-s-workspace-2");
  });
});
