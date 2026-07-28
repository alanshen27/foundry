import { describe, expect, it } from "vitest";
import {
  CURSOR_COLORS,
  CURSOR_STALE_MS,
  activeCursors,
  cursorChannel,
  cursorColor,
  type CursorState,
} from "@foundry/realtime";

function peer(partial: Partial<CursorState> = {}): CursorState {
  return {
    userId: "u1",
    name: "Ada",
    color: "#f59e0b",
    x: 10,
    y: 20,
    surface: "schematic",
    at: Date.now(),
    ...partial,
  };
}

describe("cursorColor", () => {
  it("gives the same user the same colour every time", () => {
    expect(cursorColor("user-abc")).toBe(cursorColor("user-abc"));
  });

  it("only ever returns a palette colour", () => {
    for (const id of ["a", "bb", "ccc", "user-123", ""]) {
      expect(CURSOR_COLORS).toContain(cursorColor(id));
    }
  });

  it("spreads a realistic set of ids across the palette", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `cms3ncfh${i}7dktnr31ofar`);
    const used = new Set(ids.map(cursorColor));
    // Not a guarantee of uniqueness, but a hash that collapsed everything to
    // one colour would make the feature useless.
    expect(used.size).toBeGreaterThan(3);
  });

  it("does not throw on an empty id", () => {
    expect(() => cursorColor("")).not.toThrow();
  });
});

describe("cursorChannel", () => {
  it("scopes to a project branch", () => {
    expect(cursorChannel("p1", "b1")).toBe("foundry:cursors:p1:b1");
    expect(cursorChannel("p1", "b1")).not.toBe(cursorChannel("p1", "b2"));
  });
});

describe("activeCursors", () => {
  const now = 1_000_000;

  it("keeps a fresh peer on the same surface", () => {
    expect(activeCursors([peer({ at: now })], "schematic", now)).toHaveLength(1);
  });

  it("drops a peer that has gone quiet", () => {
    const stale = peer({ at: now - CURSOR_STALE_MS - 1 });
    expect(activeCursors([stale], "schematic", now)).toHaveLength(0);
  });

  it("keeps a peer right at the staleness edge", () => {
    const edge = peer({ at: now - CURSOR_STALE_MS });
    expect(activeCursors([edge], "schematic", now)).toHaveLength(1);
  });

  it("hides peers looking at another surface", () => {
    const elsewhere = peer({ surface: "pcb", at: now });
    expect(activeCursors([elsewhere], "schematic", now)).toHaveLength(0);
    expect(activeCursors([elsewhere], "pcb", now)).toHaveLength(1);
  });

  it("filters a mixed set", () => {
    const peers = [
      peer({ userId: "a", at: now }),
      peer({ userId: "b", at: now - CURSOR_STALE_MS - 1 }),
      peer({ userId: "c", surface: "pcb", at: now }),
      peer({ userId: "d", at: now - 100 }),
    ];
    expect(activeCursors(peers, "schematic", now).map((p) => p.userId)).toEqual(["a", "d"]);
  });

  it("returns nothing for an empty set", () => {
    expect(activeCursors([], "schematic", now)).toEqual([]);
  });
});
