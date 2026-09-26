import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { cadDoc } from "@foundry/cad";
import { emptyPcbSet } from "@/lib/pcb/doc";

const access = vi.fn();
const audit = vi.fn();
const stale = vi.fn();
const humanGuard = vi.fn();
const aiGuard = vi.fn();
const branch = vi.fn();
const findDocs = vi.fn();
const upsert = vi.fn();
const execute = vi.fn();
let rows: { kind: string; data: unknown; updatedAt: Date }[];
const db = {
  projectBranch: { findFirst: (...args: unknown[]) => branch(...args) },
  designDoc: {
    findMany: (...args: unknown[]) => findDocs(...args),
    upsert: (...args: unknown[]) => upsert(...args),
  },
  $executeRaw: (...args: unknown[]) => execute(...args),
};
vi.mock("@foundry/db", () => ({ prisma: db }));
vi.mock("@foundry/collaboration/server", () => ({
  syncCollaborationSnapshot: (_tx: unknown, input: { after: unknown }) => input.after,
  publishCollaborationUpdate: vi.fn(),
}));
vi.mock("@/server/access", () => ({
  requireProjectCapability: (...args: unknown[]) => access(...args),
}));
vi.mock("@/server/audit", () => ({ recordAudit: (...args: unknown[]) => audit(...args) }));
vi.mock("@/server/stage-state", () => ({
  ensureStageStarted: vi.fn(),
  markDownstreamStale: (...args: unknown[]) => stale(...args),
}));
vi.mock("@/server/ai-edit-lock", () => ({
  AiEditLockConflict: class extends Error {},
  withAiEditLockGuard: (...args: unknown[]) => humanGuard(...args),
  withAiRunEditLockGuard: (...args: unknown[]) => aiGuard(...args),
}));
const { engineeringRouter } = await import("@/server/routers/engineering");
const { updateEngineering } = await import("@/server/engineering");
const user = {
  id: "u",
  name: "User",
  email: "u@example.com",
  avatarUrl: null,
  supabaseId: null,
  localPasswordHash: null,
  createdAt: new Date(),
};
const scope = { projectId: "p", branchId: "b" };
const caller = () => engineeringRouter.createCaller({ user });

beforeEach(() => {
  vi.resetAllMocks();
  rows = [];
  branch.mockResolvedValue({ id: "b" });
  access.mockResolvedValue({ project: { id: "p", workspaceId: "w" } });
  findDocs.mockImplementation(() => rows.slice().sort((a, b) => a.kind.localeCompare(b.kind)));
  upsert.mockImplementation(({ create }: { create: { data: unknown } }) => {
    rows = [
      ...rows.filter((row) => row.kind !== "MODEL3D"),
      { kind: "MODEL3D", data: create.data, updatedAt: new Date() },
    ];
    return { id: "doc" };
  });
  humanGuard.mockImplementation((_p: string, _b: string, fn: (db: unknown) => unknown) => fn(db));
  aiGuard.mockImplementation(
    (_p: string, _b: string, _r: string, _u: string, fn: (db: unknown) => unknown) => fn(db),
  );
});

describe("connected engineering workflow", () => {
  it("reports an empty project honestly and rejects branches outside the project", async () => {
    const status = await caller().status(scope);
    expect(status.cad.components).toEqual([]);
    expect(status.report.stages.find((s) => s.id === "cad")?.state).toBe("missing");
    branch.mockResolvedValue(null);
    await expect(caller().status(scope)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(branch).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "b", projectId: "p" } }),
    );
  });
  it("supports read-only viewers and checks mechanical capability on mutations", async () => {
    access.mockImplementation((_u: string, _p: string, cap: string) => {
      if (cap === "mechanical.edit") throw new TRPCError({ code: "FORBIDDEN" });
      return { project: { workspaceId: "w" } };
    });
    const status = await caller().status(scope);
    expect(status.canSyncCad).toBe(false);
    await expect(
      caller().syncPcbToCad({ ...scope, expectedFingerprint: status.fingerprint }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(upsert).not.toHaveBeenCalled();
  });
  it("rejects stale source without overwriting anything", async () => {
    const before = await caller().status(scope);
    rows.push({ kind: "PCB", data: emptyPcbSet(), updatedAt: new Date() });
    await expect(
      caller().syncPcbToCad({ ...scope, expectedFingerprint: before.fingerprint }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(upsert).not.toHaveBeenCalled();
  });
  it("synchronizes all boards then builds actual linked parts and audits the changes", async () => {
    const set = emptyPcbSet();
    set.boards.push({
      ...structuredClone(set.boards[0]!),
      id: "secondary",
      name: "Secondary",
      board: { ...set.boards[0]!.board, widthMm: 32 },
    });
    rows = [{ kind: "PCB", data: set, updatedAt: new Date() }];
    const status = await caller().status(scope);
    await expect(
      caller().buildAssembly({ ...scope, expectedFingerprint: status.fingerprint }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const synced = await caller().syncPcbToCad({
      ...scope,
      expectedFingerprint: status.fingerprint,
    });
    expect(synced.cad.components.filter((c) => c.source?.kind === "pcb")).toHaveLength(2);
    const built = await caller().buildAssembly({
      ...scope,
      expectedFingerprint: synced.fingerprint,
    });
    expect(built.cad.assembly?.instances).toHaveLength(2);
    expect(built.cad.components.find((c) => c.path === "assembly/product.py")?.content).toContain(
      "import",
    );
    expect(stale).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ action: "build_linked_assembly" }),
      }),
    );
  });
  it("preserves customized PCB geometry and uses the worker's own lease", async () => {
    rows = [{ kind: "PCB", data: emptyPcbSet(), updatedAt: new Date() }];
    const status = await caller().status(scope);
    const synced = await updateEngineering(
      { ...scope, userId: "u", runId: "run" },
      { action: "sync_pcb_to_cad", expectedFingerprint: status.fingerprint },
    );
    expect(aiGuard).toHaveBeenCalledWith("p", "b", "run", "u", expect.any(Function));
    const part = synced.cad.components.find((c) => c.source)!;
    part.content += "\n# custom clearance changes";
    rows = rows.map((row) => (row.kind === "MODEL3D" ? { ...row, data: synced.cad } : row));
    const current = await caller().status(scope);
    upsert.mockClear();
    await expect(
      caller().syncPcbToCad({ ...scope, expectedFingerprint: current.fingerprint }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(upsert).not.toHaveBeenCalled();
  });
  it("rejects duplicate or missing assembly references and non-finite poses", async () => {
    rows = [{ kind: "MODEL3D", data: cadDoc("x=1"), updatedAt: new Date() }];
    const status = await caller().status(scope);
    await expect(
      caller().buildAssembly({
        ...scope,
        expectedFingerprint: status.fingerprint,
        instances: [
          {
            id: "i",
            componentId: "missing",
            translationMm: { x: 0, y: 0, z: 0 },
            rotationDeg: { x: 0, y: 0, z: 0 },
            visible: true,
            fixed: false,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(upsert).not.toHaveBeenCalled();
  });
});
