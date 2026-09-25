/**
 * The proposal queue's own capability + audit guarantees, and the one
 * correctness case that matters: an endpoint that vanished between a LINK
 * proposal and its approval must auto-reject, never half-write an edge.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireProjectCapability = vi.fn();
const recordAudit = vi.fn();
const loadGraphSnapshot = vi.fn();

const proposalFindMany = vi.fn();
const proposalFindUnique = vi.fn();
const proposalUpdate = vi.fn();
const proposalUpdateMany = vi.fn();
const edgeFindUnique = vi.fn();
const userFindMany = vi.fn();
const nodeFindUnique = vi.fn();
const nodeFindMany = vi.fn();
const nodeCreate = vi.fn();
const edgeUpsert = vi.fn();

vi.mock("../server/access", () => ({
  requireProjectCapability: (...args: unknown[]) => requireProjectCapability(...args),
}));
vi.mock("../server/audit", () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...args),
}));
vi.mock("../server/graph/sync", () => ({
  syncProductGraph: vi.fn(),
  loadGraphSnapshot: (...args: unknown[]) => loadGraphSnapshot(...args),
}));
vi.mock("../server/graph/stale", () => ({
  markImpacted: vi.fn(),
  markNodeReviewed: vi.fn(),
}));
vi.mock("@foundry/db", () => ({
  prisma: {
    productNode: {
      findUnique: (...args: unknown[]) => nodeFindUnique(...args),
      findMany: (...args: unknown[]) => nodeFindMany(...args),
      create: (...args: unknown[]) => nodeCreate(...args),
    },
    productEdge: {
      upsert: (...args: unknown[]) => edgeUpsert(...args),
      findUnique: (...args: unknown[]) => edgeFindUnique(...args),
    },
    graphProposal: {
      findMany: (...args: unknown[]) => proposalFindMany(...args),
      findUnique: (...args: unknown[]) => proposalFindUnique(...args),
      update: (...args: unknown[]) => proposalUpdate(...args),
      updateMany: (...args: unknown[]) => proposalUpdateMany(...args),
    },
    user: {
      findMany: (...args: unknown[]) => userFindMany(...args),
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

const linkProposal = {
  id: "prop1",
  projectId: "proj1",
  branchId: "branch1",
  kind: "LINK" as const,
  status: "PENDING" as const,
  payload: { from: "component:c1", to: "requirement:r1", kind: "SATISFIES", rationale: "why" },
  proposedById: "agent-user",
};

const taskProposal = {
  id: "prop2",
  projectId: "proj1",
  branchId: "branch1",
  kind: "TASK" as const,
  status: "PENDING" as const,
  payload: { title: "Write firmware", detail: null, status: "todo", dependsOn: [] },
  proposedById: "agent-user",
};

beforeEach(() => {
  requireProjectCapability.mockReset().mockResolvedValue({ project });
  recordAudit.mockReset().mockResolvedValue(undefined);
  loadGraphSnapshot.mockReset().mockResolvedValue({ nodes: [], edges: [] });

  proposalFindMany.mockReset().mockResolvedValue([linkProposal]);
  proposalFindUnique.mockReset().mockResolvedValue(linkProposal);
  proposalUpdate.mockReset().mockResolvedValue({});
  proposalUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  edgeFindUnique.mockReset().mockResolvedValue(null);
  userFindMany.mockReset().mockResolvedValue([{ id: "agent-user", name: "Builder" }]);
  nodeFindUnique.mockReset().mockResolvedValue({ id: "n1" });
  nodeFindMany.mockReset().mockResolvedValue([]);
  nodeCreate.mockReset().mockResolvedValue({ id: "task-node-1" });
  edgeUpsert.mockReset().mockResolvedValue({ id: "e1" });
});

describe("listProposals", () => {
  it("needs only project.read and does not audit", async () => {
    const result = await caller().listProposals({ ...scope, status: "PENDING" });
    expect(requireProjectCapability.mock.calls.at(-1)?.[2]).toBe("project.read");
    expect(recordAudit).not.toHaveBeenCalled();
    expect(result).toEqual([expect.objectContaining({ id: "prop1", proposedByName: "Builder" })]);
  });
});

describe("approveProposal", () => {
  it("needs graph.edit and audits an approval", async () => {
    await caller().approveProposal({ ...scope, proposalId: "prop1" });
    expect(requireProjectCapability.mock.calls.at(-1)?.[2]).toBe("graph.edit");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ProductGraphProposalApproved" }),
    );
  });

  it("materialises a LINK proposal as a real edge, attributed to the proposer", async () => {
    await caller().approveProposal({ ...scope, proposalId: "prop1" });
    expect(edgeUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ origin: "AGENT", createdById: "agent-user" }),
      }),
    );
  });

  it("auto-rejects a LINK proposal whose endpoint no longer exists, rather than half-writing an edge", async () => {
    nodeFindUnique.mockResolvedValueOnce({ id: "n1" }).mockResolvedValueOnce(null);
    const result = await caller().approveProposal({ ...scope, proposalId: "prop1" });
    expect(result).toMatchObject({ decided: "REJECTED" });
    expect(edgeUpsert).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ProductGraphProposalRejected" }),
    );
  });

  it("keeps a person's existing link as theirs when approving the same link", async () => {
    edgeFindUnique.mockResolvedValue({ origin: "USER" });
    await caller().approveProposal({ ...scope, proposalId: "prop1" });
    expect(edgeUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
  });

  it("wires a task that an already-approved task was waiting on", async () => {
    proposalFindUnique.mockResolvedValue(taskProposal);
    proposalFindMany.mockResolvedValue([
      { payload: { title: "Flash board", dependsOn: ["write firmware"] }, resultNodeId: "t-flash" },
    ]);
    await caller().approveProposal({ ...scope, proposalId: "prop2" });
    expect(edgeUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          fromId: "task-node-1",
          toId: "t-flash",
          kind: "DEPENDS_ON",
        }),
      }),
    );
  });

  it("materialises a TASK proposal as a real node", async () => {
    proposalFindUnique.mockResolvedValue(taskProposal);
    const result = await caller().approveProposal({ ...scope, proposalId: "prop2" });
    expect(nodeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "TASK", origin: "AGENT", createdById: "agent-user" }),
      }),
    );
    expect(result).toMatchObject({ decided: "APPROVED", nodeId: "task-node-1" });
  });

  it("refuses to decide a proposal twice — even when two approvals race", async () => {
    // Both requests read PENDING; only one wins the conditional update.
    proposalUpdateMany.mockResolvedValue({ count: 0 });
    await expect(caller().approveProposal({ ...scope, proposalId: "prop1" })).rejects.toThrow(
      /already decided/,
    );
  });

  it("scopes to the branch: refuses a proposal from another branch", async () => {
    proposalFindUnique.mockResolvedValue({ ...linkProposal, branchId: "other" });
    await expect(caller().approveProposal({ ...scope, proposalId: "prop1" })).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("rejectProposal", () => {
  it("needs graph.edit, requires a rationale, and audits a rejection", async () => {
    await caller().rejectProposal({ ...scope, proposalId: "prop1", rationale: "Wrong part" });
    expect(requireProjectCapability.mock.calls.at(-1)?.[2]).toBe("graph.edit");
    expect(proposalUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING" }),
        data: expect.objectContaining({ status: "REJECTED" }),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ProductGraphProposalRejected" }),
    );
  });

  it("rejects an empty rationale", async () => {
    await expect(
      caller().rejectProposal({ ...scope, proposalId: "prop1", rationale: "  " }),
    ).rejects.toThrow();
  });
});
