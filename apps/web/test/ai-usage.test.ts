import { beforeEach, describe, expect, it, vi } from "vitest";

const aggregate = vi.fn();
const update = vi.fn();
let budget: number | undefined;

vi.mock("@foundry/db", () => ({
  prisma: {
    chatRun: {
      aggregate: (...args: unknown[]) => aggregate(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));
vi.mock("@foundry/config", () => ({
  getServerEnv: () => ({ AI_WORKSPACE_DAILY_TOKEN_BUDGET: budget }),
}));

const { addStepUsage, checkWorkspaceBudget, emptyUsage, recordRunUsage, workspaceUsage } =
  await import("../server/ai-usage");

beforeEach(() => {
  aggregate.mockReset();
  update.mockReset().mockResolvedValue({});
  budget = undefined;
});

describe("addStepUsage", () => {
  it("sums every field across steps", () => {
    let total = emptyUsage();
    total = addStepUsage(total, {
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      inputTokenDetails: { cacheReadTokens: 800 },
      outputTokenDetails: { reasoningTokens: 150 },
    });
    total = addStepUsage(total, { inputTokens: 500, outputTokens: 50, totalTokens: 550 });
    expect(total).toEqual({
      inputTokens: 1500,
      cachedInputTokens: 800,
      outputTokens: 250,
      reasoningTokens: 150,
      totalTokens: 1750,
      stepCount: 2,
    });
  });

  it("rebuilds a missing total from input and output", () => {
    expect(addStepUsage(emptyUsage(), { inputTokens: 30, outputTokens: 12 }).totalTokens).toBe(42);
  });

  it("counts a step even when the provider reported no usage", () => {
    expect(addStepUsage(emptyUsage(), undefined)).toMatchObject({ stepCount: 1, totalTokens: 0 });
  });
});

describe("recordRunUsage", () => {
  it("writes the model and totals onto the run", async () => {
    const usage = addStepUsage(emptyUsage(), { inputTokens: 10, outputTokens: 5 });
    await recordRunUsage("run1", "gpt-5.6", usage);
    expect(update).toHaveBeenCalledWith({
      where: { id: "run1" },
      data: expect.objectContaining({ model: "gpt-5.6", totalTokens: 15, stepCount: 1 }),
    });
  });

  it("skips a run that never reached the model", async () => {
    await recordRunUsage("run1", "gpt-5.6", emptyUsage());
    expect(update).not.toHaveBeenCalled();
  });

  it("never throws, because metering must not fail a turn", async () => {
    update.mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      recordRunUsage("run1", "m", addStepUsage(emptyUsage(), { inputTokens: 1 })),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe("workspace budget", () => {
  it("sums the last 24 hours of runs across the workspace's projects", async () => {
    aggregate.mockResolvedValue({ _sum: { totalTokens: 9000 }, _count: { _all: 4 } });
    const now = new Date("2026-09-16T12:00:00Z");
    const usage = await workspaceUsage("ws1", now);
    expect(usage).toMatchObject({ totalTokens: 9000, runs: 4, budget: null });
    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          project: { workspaceId: "ws1" },
          createdAt: { gte: new Date("2026-09-15T12:00:00Z") },
        },
      }),
    );
  });

  it("allows everything when no budget is configured", async () => {
    aggregate.mockResolvedValue({ _sum: { totalTokens: 10_000_000 }, _count: { _all: 900 } });
    expect((await checkWorkspaceBudget("ws1")).allowed).toBe(true);
  });

  it("refuses once the budget is spent, and explains how it recovers", async () => {
    budget = 50_000;
    aggregate.mockResolvedValue({ _sum: { totalTokens: 50_000 }, _count: { _all: 3 } });
    const decision = await checkWorkspaceBudget("ws1");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.message).toContain("50,000 of 50,000 tokens");
      expect(decision.message).toContain("older runs age out");
    }
  });

  it("allows while under the budget", async () => {
    budget = 50_000;
    aggregate.mockResolvedValue({ _sum: { totalTokens: 49_999 }, _count: { _all: 3 } });
    expect((await checkWorkspaceBudget("ws1")).allowed).toBe(true);
  });

  it("treats a workspace with no runs as zero usage", async () => {
    budget = 1;
    aggregate.mockResolvedValue({ _sum: { totalTokens: null }, _count: { _all: 0 } });
    expect((await checkWorkspaceBudget("ws1")).allowed).toBe(true);
  });
});
