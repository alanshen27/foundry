import { afterEach, describe, expect, it, vi } from "vitest";

const publish = vi.fn(async () => undefined);
vi.mock("server-only", () => ({}));
vi.mock("@/server/realtime", () => ({ getBroadcastPublisher: () => ({ publish }) }));

const { notifyProjectChanged } = await import("@/server/project-change");

afterEach(() => {
  vi.useRealTimers();
  publish.mockClear();
});

describe("project change notifications", () => {
  it("coalesces a burst of writes into one broadcast per branch", async () => {
    vi.useFakeTimers();
    notifyProjectChanged("p", "b", { kind: "design", design: "PCB" });
    notifyProjectChanged("p", "b", { kind: "design", design: "PCB" });
    notifyProjectChanged("p", "b", { kind: "design", design: "MODEL3D" });
    notifyProjectChanged("p", "b", { kind: "code" });
    notifyProjectChanged("p", "other", { kind: "code" });
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith("foundry:project:p:b", {
      event: "project-changed",
      payload: {
        changes: [
          { kind: "design", design: "PCB" },
          { kind: "design", design: "MODEL3D" },
          { kind: "code" },
        ],
      },
    });
  });

  it("never throws into the writer when the broadcast fails", async () => {
    vi.useFakeTimers();
    publish.mockRejectedValueOnce(new Error("offline") as never);
    expect(() => notifyProjectChanged("p", "b", { kind: "code" })).not.toThrow();
    await vi.advanceTimersByTimeAsync(300);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
