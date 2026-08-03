import { describe, expect, it } from "vitest";
import { LIVE_LOCK_TTL_MS, activeLocks, liveEditChannel, type LiveLock } from "@foundry/realtime";

function lock(partial: Partial<LiveLock> = {}): LiveLock {
  return {
    userId: "u1",
    name: "Ada",
    color: "#f59e0b",
    surface: "pcb:board-1",
    objectId: "fp-1",
    at: Date.now(),
    ...partial,
  };
}

describe("liveEditChannel", () => {
  it("scopes to project and branch, like cursors", () => {
    expect(liveEditChannel("p1", "b1")).toBe("foundry:live:p1:b1");
    expect(liveEditChannel("p1", "b2")).not.toBe(liveEditChannel("p1", "b1"));
  });
});

describe("activeLocks", () => {
  it("keeps fresh locks on the same surface", () => {
    const locks = activeLocks([lock()], "pcb:board-1", "me");
    expect(locks).toHaveLength(1);
  });

  it("drops locks on other surfaces", () => {
    expect(activeLocks([lock({ surface: "cad" })], "pcb:board-1", "me")).toHaveLength(0);
  });

  it("drops the caller's own locks so the local echo never blocks the holder", () => {
    expect(activeLocks([lock({ userId: "me" })], "pcb:board-1", "me")).toHaveLength(0);
  });

  it("expires a lock not re-announced within the TTL, so a crashed tab cannot wedge the doc", () => {
    const now = Date.now();
    const stale = lock({ at: now - LIVE_LOCK_TTL_MS - 1 });
    const fresh = lock({ userId: "u2", at: now });
    const locks = activeLocks([stale, fresh], "pcb:board-1", "me", now);
    expect(locks.map((l) => l.userId)).toEqual(["u2"]);
  });
});
