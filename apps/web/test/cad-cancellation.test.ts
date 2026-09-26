import { beforeEach, describe, expect, it, vi } from "vitest";
import { cadDoc } from "@foundry/cad";
const mocks = vi.hoisted(() => ({
  lease: vi.fn(),
  transaction: vi.fn(),
  write: vi.fn(),
  publish: vi.fn(),
  read: vi.fn(),
  lock: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("@foundry/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/server/ai-edit-lock", () => ({
  acquireBranchEditMutex: vi.fn(),
  withAiRunEditLockGuard: mocks.lease,
}));
vi.mock("@foundry/collaboration/server", () => ({
  syncCollaborationSnapshot: mocks.sync,
  publishCollaborationUpdate: mocks.publish,
}));
import { mutateModel3dDoc } from "@/server/cad-doc";
const tx = { $executeRaw: mocks.lock, designDoc: { findUnique: mocks.read, upsert: mocks.write } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(null);
  mocks.sync.mockImplementation(async (_tx, params) => params.after);
  mocks.transaction.mockImplementation(async (save) => save(tx));
});
describe("CAD commits from stopped tools", () => {
  it("refuses a late model commit from a cancelled run before touching either SQL or Yjs", async () => {
    mocks.lease.mockRejectedValue(new Error("The AI editing lease is no longer active"));
    const mutate = vi.fn(() => cadDoc("late generated model"));
    await expect(mutateModel3dDoc("p", "b", "u", mutate, "cancelled-run")).rejects.toThrow(
      "no longer active",
    );
    expect(mocks.lease).toHaveBeenCalledWith("p", "b", "cancelled-run", "u", expect.any(Function));
    expect(mutate).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("commits an active run within the lease transaction and then broadcasts", async () => {
    mocks.lease.mockImplementation(async (_p, _b, _run, _u, save) => save(tx));
    await mutateModel3dDoc("p", "b", "u", () => cadDoc("valid model"), "active-run");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(mocks.publish.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.write.mock.invocationCallOrder[0]!,
    );
  });
});
