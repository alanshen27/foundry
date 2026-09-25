/**
 * Reconciliation, which is where the graph could quietly destroy work.
 *
 * `syncProductGraph` runs after every change, so anything it deletes it
 * deletes constantly. Two invariants keep that safe, and both are asserted
 * here: it only ever removes rows it derived, and a staleness flag survives a
 * rebuild unless the artifact itself actually changed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const nodeFindMany = vi.fn();
const nodeUpsert = vi.fn();
const nodeDeleteMany = vi.fn();
const edgeUpsert = vi.fn();
const edgeDeleteMany = vi.fn();
const recordAudit = vi.fn();
const gatherProjectState = vi.fn();

const tx = {
  productNode: {
    upsert: (...args: unknown[]) => nodeUpsert(...args),
    deleteMany: (...args: unknown[]) => nodeDeleteMany(...args),
  },
  productEdge: {
    upsert: (...args: unknown[]) => edgeUpsert(...args),
    deleteMany: (...args: unknown[]) => edgeDeleteMany(...args),
  },
};

vi.mock("@foundry/db", () => ({
  prisma: {
    productNode: { findMany: (...args: unknown[]) => nodeFindMany(...args) },
    productEdge: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  },
}));
vi.mock("../server/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));
vi.mock("../server/graph/gather", () => ({
  gatherProjectState: (...a: unknown[]) => gatherProjectState(...a),
}));

const { syncProductGraph } = await import("../server/graph/sync");
const { envMonitorInput } = await import("./fixtures/env-monitor");

const run = () =>
  syncProductGraph({
    projectId: "proj1",
    branchId: "branch1",
    workspaceId: "ws1",
    actorId: "user1",
  });

/** The row shape `sync` selects when it reads what is already stored. */
const stored = (overrides: Record<string, unknown>) => ({
  id: "n-old",
  refKey: "component:gone",
  origin: "DERIVED",
  contentHash: "aaa",
  staleAt: null,
  staleContentHash: null,
  ...overrides,
});

beforeEach(() => {
  gatherProjectState.mockReset().mockResolvedValue(envMonitorInput);
  nodeFindMany.mockReset().mockResolvedValue([]);
  nodeUpsert
    .mockReset()
    .mockImplementation(
      ({ where }: { where: { projectId_branchId_refKey: { refKey: string } } }) => ({
        id: `id-${where.projectId_branchId_refKey.refKey}`,
      }),
    );
  nodeDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  edgeUpsert.mockReset().mockImplementation(() => ({ id: "e1" }));
  edgeDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  recordAudit.mockReset().mockResolvedValue(undefined);
});

describe("building a graph for the first time", () => {
  it("writes a node per derived refKey and counts them all as added", async () => {
    const result = await run();
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.added).toBe(result.nodeCount);
    expect(result.removed).toBe(0);
    expect(nodeUpsert).toHaveBeenCalledTimes(result.nodeCount);
  });

  it("records one audit event describing the sync", async () => {
    const result = await run();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ProductGraphSynced",
        workspaceId: "ws1",
        projectId: "proj1",
        payload: expect.objectContaining({ nodeCount: result.nodeCount }),
      }),
    );
  });
});

describe("what a rebuild is allowed to delete", () => {
  it("removes a derived node the project no longer implies", async () => {
    nodeFindMany.mockResolvedValue([stored({})]);
    const result = await run();
    expect(result.removed).toBe(1);
    expect(nodeDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["n-old"] } } });
  });

  it.each(["USER", "AGENT", "IMPORT"])(
    "never removes a %s node, however stale the derivation",
    async (origin) => {
      nodeFindMany.mockResolvedValue([stored({ refKey: "task:t1", origin })]);
      const result = await run();
      expect(result.removed).toBe(0);
      expect(nodeDeleteMany).not.toHaveBeenCalled();
    },
  );

  it("only ever deletes edges it derived", async () => {
    await run();
    // The delete is scoped to origin DERIVED, so an edge a person drew — the
    // ones carrying engineering judgement — cannot be swept up by a resync.
    expect(edgeDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ origin: "DERIVED" }),
      }),
    );
  });

  it("writes every derived edge as DERIVED", async () => {
    await run();
    for (const call of edgeUpsert.mock.calls) {
      expect(call[0].create.origin).toBe("DERIVED");
    }
  });
});

describe("staleness across a rebuild", () => {
  const flagged = (contentHash: string, staleContentHash: string) =>
    stored({
      id: "id-component:cmp-battery",
      refKey: "component:cmp-battery",
      contentHash,
      staleContentHash,
      staleAt: new Date("2026-09-01"),
    });

  const upsertFor = (refKey: string) =>
    nodeUpsert.mock.calls.find((c) => c[0].where.projectId_branchId_refKey.refKey === refKey)?.[0];

  it("clears the flag once the artifact's content has moved", async () => {
    // The stored hash no longer matches what the artifact derives to, so
    // somebody revised it and the flag has done its job.
    nodeFindMany.mockResolvedValue([flagged("stale-hash", "stale-hash")]);
    const result = await run();
    expect(result.refreshed).toBe(1);
    expect(upsertFor("component:cmp-battery").update.staleAt).toBeNull();
  });

  it("keeps the flag when nothing about the artifact changed", async () => {
    // Derive the true hash, then claim the node was flagged at exactly that
    // content — nobody has touched it since.
    const { deriveGraph } = await import("@/lib/graph/derive");
    const derived = deriveGraph(envMonitorInput);
    const battery = derived.nodes.find((n) => n.refKey === "component:cmp-battery")!;
    nodeFindMany.mockResolvedValue([flagged(battery.contentHash!, battery.contentHash!)]);

    const result = await run();
    expect(result.refreshed).toBe(0);
    // The update must not mention staleAt at all — leaving the field out is
    // what preserves it.
    expect(upsertFor("component:cmp-battery").update).not.toHaveProperty("staleAt");
  });

  it("never clears a flag on a node it is creating for the first time", async () => {
    nodeFindMany.mockResolvedValue([]);
    await run();
    for (const call of nodeUpsert.mock.calls) {
      expect(call[0].create).not.toHaveProperty("staleAt");
    }
  });
});

describe("what an upsert is allowed to overwrite", () => {
  it("refreshes the label and hash but never the origin", async () => {
    await run();
    const update = nodeUpsert.mock.calls[0]![0].update;
    expect(update).toHaveProperty("label");
    expect(update).toHaveProperty("contentHash");
    // A node a person promoted to USER must not be demoted back to DERIVED.
    expect(update).not.toHaveProperty("origin");
    expect(update).not.toHaveProperty("reviewedAt");
  });
});

describe("reusing an existing fit report", () => {
  it("does not re-run the simulation when one is handed in", async () => {
    const report = {
      ok: true,
      findings: [],
      counts: { errors: 0, warnings: 0 },
      simulation: { ran: false, reason: "supplied by caller" } as const,
    };
    await syncProductGraph({
      projectId: "proj1",
      branchId: "branch1",
      workspaceId: "ws1",
      actorId: "user1",
      report,
    });
    // With no simulation there are no firmware->pin edges, which is how we
    // can tell the supplied report was used rather than a fresh run.
    const drives = edgeUpsert.mock.calls.filter((c) => c[0].create.kind === "DRIVES");
    expect(drives).toHaveLength(0);
  });
});

describe("which impacted artifacts actually get flagged", () => {
  // Regression: the first version flagged everything the traversal reached,
  // which on the demo project meant 22 of 30 nodes — including every net and
  // MCU pin. Nobody revises a net in response to a battery swap, and a review
  // queue full of them is a review queue people stop reading.
  it("covers the artifacts a person opens and excludes the intermediates", async () => {
    const { REVIEWABLE_NODE_KINDS } = await import("@/lib/graph/types");
    for (const kind of ["REQUIREMENT", "COMPONENT", "CHECK", "FIRMWARE_FILE", "CAD_PART"]) {
      expect(REVIEWABLE_NODE_KINDS.has(kind as never)).toBe(true);
    }
    for (const kind of ["NET", "MCU_PIN", "CIRCUIT_PART", "FOOTPRINT"]) {
      expect(REVIEWABLE_NODE_KINDS.has(kind as never)).toBe(false);
    }
  });
});
