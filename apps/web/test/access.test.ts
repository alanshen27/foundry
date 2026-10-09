import { beforeEach, describe, expect, it, vi } from "vitest";

const projectFindUnique = vi.fn();
const membershipFindFirst = vi.fn();
const membershipFindUnique = vi.fn();

vi.mock("@foundry/db", () => ({
  prisma: {
    project: { findUnique: (...args: unknown[]) => projectFindUnique(...args) },
    workspaceMembership: {
      findFirst: (...args: unknown[]) => membershipFindFirst(...args),
      findUnique: (...args: unknown[]) => membershipFindUnique(...args),
    },
  },
}));

const { requireProjectCapability } = await import("../server/access");

const project = { id: "p1", workspaceId: "w1" };
const membership = (overrides: Record<string, unknown> = {}) => ({
  id: "m1",
  workspaceId: "w1",
  userId: "u1",
  role: "GUEST",
  grants: [],
  ...overrides,
});

describe("requireProjectCapability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindUnique.mockResolvedValue(project);
  });

  it("loads the project and the caller's membership in parallel", async () => {
    let resolveProject!: (value: unknown) => void;
    projectFindUnique.mockReturnValue(new Promise((resolve) => (resolveProject = resolve)));
    membershipFindFirst.mockResolvedValue(membership());
    const pending = requireProjectCapability("u1", "p1", "project.read");
    await Promise.resolve();
    expect(membershipFindFirst).toHaveBeenCalledWith({
      where: { userId: "u1", workspace: { projects: { some: { id: "p1" } } } },
      include: { grants: true },
    });
    resolveProject(project);
    await expect(pending).resolves.toMatchObject({ project, role: "GUEST" });
    expect(membershipFindUnique).not.toHaveBeenCalled();
  });

  it("rejects non-members and memberships from another workspace", async () => {
    membershipFindFirst.mockResolvedValueOnce(null);
    await expect(requireProjectCapability("u1", "p1", "project.read")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    membershipFindFirst.mockResolvedValueOnce(membership({ workspaceId: "other" }));
    await expect(requireProjectCapability("u1", "p1", "project.read")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("reports a missing project and enforces project-scoped grants", async () => {
    projectFindUnique.mockResolvedValueOnce(null);
    membershipFindFirst.mockResolvedValueOnce(null);
    await expect(requireProjectCapability("u1", "p1", "project.read")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    membershipFindFirst.mockResolvedValueOnce(
      membership({ grants: [{ projectId: "p2", capability: "electronics.edit" }] }),
    );
    await expect(requireProjectCapability("u1", "p1", "electronics.edit")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    membershipFindFirst.mockResolvedValueOnce(
      membership({ grants: [{ projectId: "p1", capability: "electronics.edit" }] }),
    );
    await expect(requireProjectCapability("u1", "p1", "electronics.edit")).resolves.toBeTruthy();
  });
});
