import { beforeEach, describe, expect, it, vi } from "vitest";

const requireProjectCapability = vi.fn();
const recordAudit = vi.fn();
const findMany = vi.fn();
const updateMany = vi.fn();
const executeRaw = vi.fn();
const persistCancelledRunFromEvents = vi.fn();
const publishRunFinished = vi.fn();

vi.mock("../server/access", () => ({
  requireProjectCapability: (...args: unknown[]) => requireProjectCapability(...args),
}));
vi.mock("../server/audit", () => ({ recordAudit: (...args: unknown[]) => recordAudit(...args) }));
vi.mock("@foundry/db", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        $executeRaw: (...args: unknown[]) => executeRaw(...args),
        chatRun: { updateMany: (...args: unknown[]) => updateMany(...args) },
      }),
    chatRun: {
      findMany: (...args: unknown[]) => findMany(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}));
vi.mock("../server/chat-run/persist", () => ({
  loadChannelHistory: vi.fn(),
  persistRunMessages: vi.fn(),
  persistCancelledRunFromEvents: (...args: unknown[]) => persistCancelledRunFromEvents(...args),
}));
vi.mock("../server/chat-run/publish", () => ({
  publishRunFinished: (...args: unknown[]) => publishRunFinished(...args),
}));
vi.mock("../server/chat-run/stale", () => ({ expireStaleChatRuns: vi.fn() }));

const { chatRouter } = await import("../server/routers/chat");
const user = {
  id: "user1",
  email: "builder@foundry.local",
  name: "Builder",
  avatarUrl: null,
  supabaseId: null,
  localPasswordHash: null,
  createdAt: new Date(),
};
const inputMessages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "build" }] }];
const run = { id: "run1", branchId: "b1", channelId: "c1", inputMessages };

beforeEach(() => {
  requireProjectCapability
    .mockReset()
    .mockResolvedValue({ project: { id: "p1", workspaceId: "w1" } });
  recordAudit.mockReset().mockResolvedValue(undefined);
  findMany.mockReset().mockResolvedValue([run]);
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  executeRaw.mockReset().mockResolvedValue(1);
  persistCancelledRunFromEvents.mockReset().mockResolvedValue(1);
  publishRunFinished.mockReset().mockResolvedValue(undefined);
});

describe("chat.cancelActiveRun", () => {
  it("cancels only the requested active run and saves stopped history before publishing", async () => {
    const order: string[] = [];
    persistCancelledRunFromEvents.mockImplementation(async () => {
      order.push("persist");
      return 1;
    });
    publishRunFinished.mockImplementation(async () => {
      order.push("publish");
    });
    await chatRouter
      .createCaller({ user })
      .cancelActiveRun({ projectId: "p1", branchId: "b1", runId: "run1" });
    expect(requireProjectCapability).toHaveBeenCalledWith("user1", "p1", "agent.invoke");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "p1", id: "run1", status: { in: ["PENDING", "RUNNING"] } },
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "p1", id: "run1", status: { in: ["PENDING", "RUNNING"] } },
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
    expect(persistCancelledRunFromEvents).toHaveBeenCalledWith({
      runId: "run1",
      scope: { projectId: "p1", branchId: "b1", channelId: "c1" },
      inputMessages,
    });
    expect(order).toEqual(["persist", "publish"]);
    expect(executeRaw).toHaveBeenCalledWith(expect.any(Array), "p1:b1");
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      updateMany.mock.invocationCallOrder[0]!,
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ChatRunCancelled",
        actorId: "user1",
        payload: { runId: "run1", channelId: "c1" },
      }),
    );
  });

  it("does not relabel a run that finishes while cancellation is being requested", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await chatRouter.createCaller({ user }).cancelActiveRun({ projectId: "p1", runId: "run1" });
    expect(persistCancelledRunFromEvents).not.toHaveBeenCalled();
    expect(publishRunFinished).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("branch cancellation cannot catch a newer run created after the snapshot", async () => {
    findMany.mockResolvedValue([run, { ...run, id: "run2" }]);
    await chatRouter.createCaller({ user }).cancelActiveRun({ projectId: "p1", branchId: "b1" });
    expect(updateMany.mock.calls.map(([args]) => args.where.id)).toEqual(["run1", "run2"]);
  });

  it("does nothing when the requested run is already terminal", async () => {
    findMany.mockResolvedValue([]);
    await chatRouter.createCaller({ user }).cancelActiveRun({ projectId: "p1", runId: "run1" });
    expect(updateMany).not.toHaveBeenCalled();
    expect(publishRunFinished).not.toHaveBeenCalled();
  });
});
