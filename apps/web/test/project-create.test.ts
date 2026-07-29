import { beforeEach, describe, expect, it, vi } from "vitest";

const requireWorkspaceCapability = vi.fn();
const recordAudit = vi.fn();
const projectFindUnique = vi.fn();
const projectCreate = vi.fn();
const projectUpdate = vi.fn();
const projectBranchCreate = vi.fn();
const stageStateCreateMany = vi.fn();
const workspaceCreate = vi.fn();

vi.mock("../server/access", () => ({
  requireWorkspaceCapability: (...args: unknown[]) => requireWorkspaceCapability(...args),
}));

vi.mock("../server/audit", () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...args),
}));

vi.mock("@foundry/db", () => ({
  prisma: {
    project: {
      findUnique: (...args: unknown[]) => projectFindUnique(...args),
      create: (...args: unknown[]) => projectCreate(...args),
      update: (...args: unknown[]) => projectUpdate(...args),
    },
    projectBranch: {
      create: (...args: unknown[]) => projectBranchCreate(...args),
    },
    stageState: {
      createMany: (...args: unknown[]) => stageStateCreateMany(...args),
    },
    workspace: {
      create: (...args: unknown[]) => workspaceCreate(...args),
    },
  },
}));

const { projectRouter } = await import("../server/routers/project");

beforeEach(() => {
  requireWorkspaceCapability.mockReset().mockResolvedValue(undefined);
  recordAudit.mockReset().mockResolvedValue(undefined);
  projectFindUnique.mockReset().mockResolvedValue(null);
  projectCreate.mockReset().mockResolvedValue({
    id: "proj1",
    workspaceId: "ws1",
    name: "Air Quality Monitor",
    slug: "air-quality-monitor",
    description: "Pocket air quality monitor",
    folderId: null,
    createdById: "user1",
  });
  projectUpdate.mockReset().mockResolvedValue({});
  projectBranchCreate.mockReset().mockResolvedValue({ id: "branch1", name: "main" });
  stageStateCreateMany.mockReset().mockResolvedValue({ count: 4 });
  workspaceCreate.mockReset();
});

describe("project.create", () => {
  it("creates a Project under the given workspace and never creates a Workspace", async () => {
    const caller = projectRouter.createCaller({
      user: {
        id: "user1",
        email: "builder@foundry.local",
        name: "Builder",
        avatarUrl: null,
        supabaseId: null,
        localPasswordHash: null,
        createdAt: new Date(),
      },
    });

    const project = await caller.create({
      workspaceId: "ws1",
      name: "Air Quality Monitor",
      description: "Pocket air quality monitor",
      folderId: null,
    });

    expect(workspaceCreate).not.toHaveBeenCalled();
    expect(projectCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws1",
        name: "Air Quality Monitor",
        slug: "air-quality-monitor",
        createdById: "user1",
      }),
    });
    expect(projectBranchCreate).toHaveBeenCalled();
    expect(stageStateCreateMany).toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ProjectCreated", projectId: "proj1", workspaceId: "ws1" }),
    );
    expect(project.slug).toBe("air-quality-monitor");
  });
});
