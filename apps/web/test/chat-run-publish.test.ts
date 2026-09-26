import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";
const state = vi.hoisted(() => ({ createMany: vi.fn(), upsert: vi.fn(), broadcast: vi.fn() }));
vi.mock("@foundry/db", () => ({
  prisma: { chatRunEvent: { createMany: state.createMany, upsert: state.upsert } },
}));
vi.mock("@foundry/realtime", () => ({ copilotBroadcastChannel: (id: string) => `channel:${id}` }));
vi.mock("@/server/realtime", () => ({
  getBroadcastPublisher: () => ({ publish: state.broadcast }),
}));
import { publishRunChunks, publishRunChunk, publishRunFinished } from "@/server/chat-run/publish";
beforeEach(() => vi.clearAllMocks());
describe("chat stream publishing", () => {
  it("commits an ordered batch without opening unused broadcast subscriptions", async () => {
    const chunk: UIMessageChunk = { type: "start", messageId: "assistant_run" };
    await publishRunChunks("run", [
      { seq: 3, chunk },
      { seq: 4, chunk: { type: "start-step" } },
    ]);
    expect(state.createMany).toHaveBeenCalledWith({
      data: [
        { runId: "run", seq: 3, chunk },
        { runId: "run", seq: 4, chunk: { type: "start-step" } },
      ],
      skipDuplicates: true,
    });
    expect(state.broadcast).not.toHaveBeenCalled();
  });
  it("keeps single-event writes durable without duplicate transport work", async () => {
    await publishRunChunk("run", "channel", 1, { type: "start", messageId: "assistant_run" });
    expect(state.upsert).toHaveBeenCalledOnce();
    expect(state.broadcast).not.toHaveBeenCalled();
  });
  it("still broadcasts terminal state for other tabs and worker cancellation", async () => {
    await publishRunFinished("run", "channel", "cancelled", "cancelled");
    expect(state.broadcast).toHaveBeenCalledWith("channel:channel", {
      event: "run-finished",
      payload: { runId: "run", status: "cancelled", error: "cancelled" },
    });
  });
});
