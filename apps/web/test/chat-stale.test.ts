import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Run = {
  id: string;
  projectId: string;
  branchId: string;
  channelId: string;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  inputMessages: unknown[];
};
type Where = {
  id?: string;
  status?: string;
  projectId?: string;
  branchId?: string;
  channelId?: string;
  createdAt?: { lt: Date };
  startedAt?: { lt: Date } | null;
  OR?: Where[];
};
const now = 1_800_000_000_000;
let rows: Run[] = [];
let beforeUpdate: (() => void) | undefined;
function matches(row: Run, where: Where): boolean {
  if (where.id && row.id !== where.id) return false;
  if (where.status && row.status !== where.status) return false;
  if (where.projectId && row.projectId !== where.projectId) return false;
  if (where.branchId && row.branchId !== where.branchId) return false;
  if (where.channelId && row.channelId !== where.channelId) return false;
  if (where.createdAt && row.createdAt >= where.createdAt.lt) return false;
  if (where.startedAt === null && row.startedAt !== null) return false;
  if (where.startedAt && (!row.startedAt || row.startedAt >= where.startedAt.lt)) return false;
  if (where.OR && !where.OR.some((alternative) => matches(row, alternative))) return false;
  return true;
}
const findMany = vi.fn(async ({ where }: { where: Where }) =>
  rows.filter((row) => matches(row, where)).map((row) => ({ ...row })),
);
const updateMany = vi.fn(async ({ where, data }: { where: Where; data: { status: string } }) => {
  beforeUpdate?.();
  beforeUpdate = undefined;
  const selected = rows.filter((row) => matches(row, where));
  for (const row of selected) row.status = data.status;
  return { count: selected.length };
});
const persistFailedRunFromEvents = vi.fn();
const publishRunFinished = vi.fn();
vi.mock("@foundry/db", () => ({ prisma: { chatRun: { findMany, updateMany } } }));
vi.mock("../server/chat-run/persist", () => ({
  persistFailedRunFromEvents: (...args: unknown[]) => persistFailedRunFromEvents(...args),
}));
vi.mock("../server/chat-run/publish", () => ({
  publishRunFinished: (...args: unknown[]) => publishRunFinished(...args),
}));
const { expireStaleChatRuns, expireStaleProjectRuns } = await import("../server/chat-run/stale");

function run(id = "r1", status = "RUNNING"): Run {
  return {
    id,
    status,
    projectId: "p1",
    branchId: "b1",
    channelId: "c1",
    createdAt: new Date(now - 300_000),
    startedAt: status === "RUNNING" ? new Date(now - 240_000) : null,
    inputMessages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "build" }] }],
  };
}
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  rows = [run()];
  beforeUpdate = undefined;
  findMany.mockClear();
  updateMany.mockClear();
  persistFailedRunFromEvents.mockReset().mockResolvedValue(1);
  publishRunFinished.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("stale run transitions", () => {
  it("does not overwrite cancellation that wins after the stale query", async () => {
    beforeUpdate = () => {
      rows[0]!.status = "CANCELLED";
    };
    expect(await expireStaleChatRuns("c1")).toBe(0);
    expect(rows[0]!.status).toBe("CANCELLED");
    expect(persistFailedRunFromEvents).not.toHaveBeenCalled();
    expect(publishRunFinished).not.toHaveBeenCalled();
  });

  it("does not expire a worker that refreshes its heartbeat after the stale query", async () => {
    beforeUpdate = () => {
      rows[0]!.startedAt = new Date(now);
    };
    expect(await expireStaleChatRuns("c1")).toBe(0);
    expect(rows[0]!.status).toBe("RUNNING");
    expect(publishRunFinished).not.toHaveBeenCalled();
  });

  it("does not expire a pending run claimed by a worker after the stale query", async () => {
    rows = [run("r1", "PENDING")];
    beforeUpdate = () => {
      rows[0]!.status = "RUNNING";
      rows[0]!.startedAt = new Date(now);
    };
    expect(await expireStaleChatRuns("c1")).toBe(0);
    expect(rows[0]!.status).toBe("RUNNING");
    expect(persistFailedRunFromEvents).not.toHaveBeenCalled();
  });

  it("persists and announces only rows that actually transition to error", async () => {
    rows = [run("finished"), run("expired")];
    beforeUpdate = () => {
      rows[0]!.status = "DONE";
    };
    expect(await expireStaleProjectRuns("p1", "b1")).toBe(1);
    expect(rows.map((row) => row.status)).toEqual(["DONE", "ERROR"]);
    expect(publishRunFinished).toHaveBeenCalledOnce();
    expect(publishRunFinished).toHaveBeenCalledWith(
      "expired",
      "c1",
      "error",
      "Timed out (stale run)",
    );
    expect(persistFailedRunFromEvents).toHaveBeenCalledOnce();
    expect(persistFailedRunFromEvents).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "expired", error: "Timed out (stale run)" }),
    );
  });

  it("retains pending timeout behavior for a run still waiting for a worker", async () => {
    rows = [run("pending", "PENDING")];
    expect(await expireStaleChatRuns("c1")).toBe(1);
    expect(rows[0]!.status).toBe("ERROR");
    expect(publishRunFinished).toHaveBeenCalledWith(
      "pending",
      "c1",
      "error",
      "Timed out waiting for worker (check Redis / chat worker)",
    );
  });
});
