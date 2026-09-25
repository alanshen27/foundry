/**
 * The router's job is not the graph logic — that is tested purely elsewhere —
 * it is the guarantee every mutating procedure in this codebase carries: the
 * caller's capability is checked, and what they did is recorded. A procedure
 * that quietly skips either is the kind of gap nothing else would catch.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireProjectCapability = vi.fn();
const recordAudit = vi.fn();
const syncProductGraph = vi.fn();
const loadGraphSnapshot = vi.fn();
const markImpacted = vi.fn();
const markNodeReviewed = vi.fn();

const nodeFindUnique = vi.fn();
const nodeFindMany = vi.fn();
const nodeUpsert = vi.fn();
const nodeDelete = vi.fn();
const edgeFindUnique = vi.fn();
const edgeUpsert = vi.fn();
const edgeDelete = vi.fn();

vi.mock("../server/access", () => ({
  requireProjectCapability: (...args: unknown[]) => requireProjectCapability(...args),
}));
vi.mock("../server/audit", () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...args),
}));
vi.mock("../server/graph/sync", () => ({
  syncProductGraph: (...args: unknown[]) => syncProductGraph(...args),
  loadGraphSnapshot: (...args: unknown[]) => loadGraphSnapshot(...args),
}));
vi.mock("../server/graph/stale", () => ({
  markImpacted: (...args: unknown[]) => markImpacted(...args),
  markNodeReviewed: (...args: unknown[]) => markNodeReviewed(...args),
}));
vi.mock("@foundry/db", () => ({
  prisma: {
    productNode: {
      findUnique: (...args: unknown[]) => nodeFindUnique(...args),
      findMany: (...args: unknown[]) => nodeFindMany(...args),
      upsert: (...args: unknown[]) => nodeUpsert(...args),
      delete: (...args: unknown[]) => nodeDelete(...args),
    },
    productEdge: {
      findUnique: (...args: unknown[]) => edgeFindUnique(...args),
      upsert: (...args: unknown[]) => edgeUpsert(...args),
      delete: (...args: unknown[]) => edgeDelete(...args),
    },
  },
}));

const { graphRouter } = await import("../server/routers/graph");

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
const caller = () => graphRouter.createCaller({ user });
const scope = { projectId: "proj1", branchId: "branch1" };

beforeEach(() => {
  requireProjectCapability.mockReset().mockResolvedValue({ project });
  recordAudit.mockReset().mockResolvedValue(undefined);
  syncProductGraph
    .mockReset()
    .mockResolvedValue({ nodeCount: 3, edgeCount: 2, added: 3, removed: 0, refreshed: 0 });
  loadGraphSnapshot.mockReset().mockResolvedValue({ nodes: [], edges: [] });
  markImpacted.mockReset().mockResolvedValue({ root: "component:c1", marked: 2, impacted: [] });
  markNodeReviewed.mockReset().mockResolvedValue(undefined);

  nodeFindUnique.mockReset().mockResolvedValue({
    id: "n1",
    projectId: "proj1",
    branchId: "branch1",
    refKey: "component:c1",
    kind: "COMPONENT",
    origin: "USER",
  });
  nodeFindMany.mockReset().mockResolvedValue([]);
  nodeUpsert.mockReset().mockImplementation(({ create }: { create: Record<string, unknown> }) => ({
    id: "n9",
    ...create,
  }));
  nodeDelete.mockReset().mockResolvedValue({});
  edgeFindUnique.mockReset().mockResolvedValue({
    id: "e1",
    projectId: "proj1",
    branchId: "branch1",
    kind: "SATISFIES",
  });
  edgeUpsert.mockReset().mockResolvedValue({ id: "e9" });
  edgeDelete.mockReset().mockResolvedValue({});
});

const capabilityUsed = () => requireProjectCapability.mock.calls.at(-1)?.[2];

describe("read procedures need only project.read", () => {
  it.each([
    ["snapshot", () => caller().snapshot(scope)],
    ["staleNodes", () => caller().staleNodes(scope)],
    ["impact", () => caller().impact({ ...scope, refKey: "component:c1" })],
    ["provenance", () => caller().provenance({ ...scope, refKey: "component:c1" })],
    [
      "compareBranches",
      () => caller().compareBranches({ projectId: "proj1", branchAId: "b1", branchBId: "b2" }),
    ],
  ])("%s", async (_name, call) => {
    await call();
    expect(capabilityUsed()).toBe("project.read");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("every mutation checks graph.edit and records an audit event", () => {
  it("sync", async () => {
    await caller().sync(scope);
    expect(capabilityUsed()).toBe("graph.edit");
    // sync records its own audit inside syncProductGraph.
    expect(syncProductGraph).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws1", actorId: "user1" }),
    );
  });

  it("markImpacted", async () => {
    await caller().markImpacted({ ...scope, refKey: "component:c1" });
    expect(capabilityUsed()).toBe("graph.edit");
    expect(markImpacted).toHaveBeenCalledWith(
      expect.objectContaining({ refKey: "component:c1", workspaceId: "ws1" }),
    );
  });

  it("markReviewed", async () => {
    nodeFindUnique.mockResolvedValue({ id: "n1", projectId: "proj1", branchId: "branch1" });
    await caller().markReviewed({ ...scope, nodeId: "n1" });
    expect(capabilityUsed()).toBe("graph.edit");
    expect(markNodeReviewed).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "n1" }));
  });

  it("linkNodes", async () => {
    await caller().linkNodes({
      ...scope,
      from: "component:c1",
      to: "requirement:r1",
      kind: "SATISFIES",
      rationale: "Capacity is what the runtime budget is drawn against",
    });
    expect(capabilityUsed()).toBe("graph.edit");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ProductEdgeCreated", workspaceId: "ws1", actorId: "user1" }),
    );
  });

  it("unlinkNodes", async () => {
    await caller().unlinkNodes({ ...scope, edgeId: "e1" });
    expect(capabilityUsed()).toBe("graph.edit");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ProductEdgeDeleted" }),
    );
  });

  it("upsertTask", async () => {
    await caller().upsertTask({ ...scope, title: "Write the power driver" });
    expect(capabilityUsed()).toBe("graph.edit");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ProductNodeCreated" }),
    );
  });

  it("deleteTask", async () => {
    nodeFindUnique.mockResolvedValue({
      id: "n1",
      projectId: "proj1",
      branchId: "branch1",
      refKey: "task:t1",
      kind: "TASK",
      origin: "USER",
    });
    await caller().deleteTask({ ...scope, nodeId: "n1" });
    expect(capabilityUsed()).toBe("graph.edit");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ProductNodeDeleted" }),
    );
  });
});

describe("linkNodes", () => {
  it("records the author's rationale as the edge's evidence", async () => {
    await caller().linkNodes({
      ...scope,
      from: "component:c1",
      to: "requirement:r1",
      kind: "SATISFIES",
      rationale: "The cell is the heaviest item in the build",
    });
    expect(edgeUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          origin: "USER",
          evidence: "The cell is the heaviest item in the build",
        }),
      }),
    );
  });

  it("promotes a derived edge to USER when a person confirms it", async () => {
    await caller().linkNodes({
      ...scope,
      from: "component:c1",
      to: "requirement:r1",
      kind: "SATISFIES",
      rationale: "Confirmed",
    });
    // Promotion is what stops the next resync deleting a link a human vouched for.
    expect(edgeUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ origin: "USER" }) }),
    );
  });

  it("refuses a self-link", async () => {
    await expect(
      caller().linkNodes({
        ...scope,
        from: "component:c1",
        to: "component:c1",
        kind: "SATISFIES",
        rationale: "nonsense",
      }),
    ).rejects.toThrow(/cannot depend on itself/);
  });

  it("refuses when an endpoint is not in the graph", async () => {
    nodeFindUnique.mockResolvedValue(null);
    await expect(
      caller().linkNodes({
        ...scope,
        from: "component:missing",
        to: "requirement:r1",
        kind: "SATISFIES",
        rationale: "x",
      }),
    ).rejects.toThrow(/No graph node/);
  });

  it("requires a rationale", async () => {
    await expect(
      caller().linkNodes({
        ...scope,
        from: "component:c1",
        to: "requirement:r1",
        kind: "SATISFIES",
        rationale: "  ",
      }),
    ).rejects.toThrow();
  });
});

describe("cross-branch safety", () => {
  it("will not clear a node belonging to another project", async () => {
    nodeFindUnique.mockResolvedValue({ id: "n1", projectId: "other", branchId: "branch1" });
    await expect(caller().markReviewed({ ...scope, nodeId: "n1" })).rejects.toThrow(/not found/i);
    expect(markNodeReviewed).not.toHaveBeenCalled();
  });

  it("will not delete an edge belonging to another branch", async () => {
    edgeFindUnique.mockResolvedValue({ id: "e1", projectId: "proj1", branchId: "other" });
    await expect(caller().unlinkNodes({ ...scope, edgeId: "e1" })).rejects.toThrow(/not found/i);
    expect(edgeDelete).not.toHaveBeenCalled();
  });
});

describe("deleteTask", () => {
  it("refuses to delete a derived node", async () => {
    nodeFindUnique.mockResolvedValue({
      id: "n1",
      projectId: "proj1",
      branchId: "branch1",
      refKey: "component:c1",
      kind: "COMPONENT",
      origin: "DERIVED",
    });
    // Deleting a projection would only have it reappear at the next sync.
    await expect(caller().deleteTask({ ...scope, nodeId: "n1" })).rejects.toThrow(
      /edit the artifact instead/,
    );
    expect(nodeDelete).not.toHaveBeenCalled();
  });
});

describe("capability failures stop the write", () => {
  it("propagates the rejection and writes nothing", async () => {
    requireProjectCapability.mockRejectedValue(new Error("Missing capability: graph.edit"));
    await expect(caller().sync(scope)).rejects.toThrow(/graph.edit/);
    expect(syncProductGraph).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
