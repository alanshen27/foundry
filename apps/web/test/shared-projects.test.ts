import { describe, expect, it } from "vitest";
import { selectSharedProjects, type SharedMembership } from "@/lib/shared-projects";

function membership(overrides: Partial<SharedMembership> = {}): SharedMembership {
  return {
    role: "MEMBER",
    grants: [],
    workspace: {
      id: "ws1",
      name: "Rover Labs",
      slug: "rover-labs",
      createdBy: { name: "Ada" },
      projects: [
        { id: "p2", name: "Beacon", slug: "beacon" },
        { id: "p1", name: "Arm", slug: "arm" },
      ],
    },
    ...overrides,
  };
}

describe("selectSharedProjects", () => {
  it("flattens memberships into one list sorted by workspace then project", () => {
    const shared = selectSharedProjects([
      membership(),
      membership({
        workspace: {
          id: "ws2",
          name: "Atlas Works",
          slug: "atlas-works",
          createdBy: { name: "Grace" },
          projects: [{ id: "p3", name: "Chassis", slug: "chassis" }],
        },
      }),
    ]);

    expect(shared.map((p) => p.name)).toEqual(["Chassis", "Arm", "Beacon"]);
    expect(shared[0]).toMatchObject({
      workspaceName: "Atlas Works",
      workspaceSlug: "atlas-works",
      ownerName: "Grace",
      role: "MEMBER",
    });
  });

  it("limits a guest to its project-scoped grants", () => {
    const shared = selectSharedProjects([
      membership({ role: "GUEST", grants: [{ projectId: "p1" }] }),
    ]);

    expect(shared.map((p) => p.id)).toEqual(["p1"]);
  });

  it("keeps every project for a guest granted workspace-wide", () => {
    const shared = selectSharedProjects([
      membership({ role: "GUEST", grants: [{ projectId: null }] }),
    ]);

    expect(shared.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("returns nothing when no workspace is shared", () => {
    expect(selectSharedProjects([])).toEqual([]);
  });
});
