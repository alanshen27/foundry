import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRunEventStream } from "@/server/chat-run/stream";
const db = vi.hoisted(() => ({ run: vi.fn(), events: vi.fn() }));
vi.mock("@foundry/db", () => ({
  prisma: {
    chatRun: { findUnique: db.run },
    chatRunEvent: { findMany: db.events },
  },
}));
beforeEach(() => vi.clearAllMocks());
async function consume() {
  return new Response(await createRunEventStream("run")).text();
}
describe("terminal run SSE replay", () => {
  it.each([{ events: [] }, { events: [{ seq: 1, chunk: { type: "start", messageId: "a" } }] }])(
    "signals SDK abort on cancellation, including a stop before the first token (%j)",
    async ({ events }) => {
      db.run.mockResolvedValue({ status: "CANCELLED", createdAt: new Date(), error: "cancelled" });
      db.events.mockResolvedValue(events);
      const stream = await consume();
      expect(stream).toContain('data: {"type":"abort"}');
      expect(stream).not.toContain('"type":"error"');
      expect(stream).toContain(": done");
    },
  );
  it("reports the stored provider error on a failed run", async () => {
    db.run.mockResolvedValue({
      status: "ERROR",
      createdAt: new Date(),
      error: "Provider rejected request",
    });
    db.events.mockResolvedValue([{ seq: 1, chunk: { type: "start", messageId: "a" } }]);
    expect(await consume()).toContain('"errorText":"Provider rejected request"');
  });
  it("leaves a successful run successful", async () => {
    db.run.mockResolvedValue({ status: "DONE", createdAt: new Date(), error: null });
    db.events.mockResolvedValue([]);
    expect(await consume()).toBe(": done\n\n");
  });
});
