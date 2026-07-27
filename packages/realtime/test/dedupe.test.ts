import { describe, expect, it } from "vitest";
import { dedupePresenceMembers } from "../src/dedupe";

describe("dedupePresenceMembers", () => {
  it("keeps one entry per userId, preferring the latest joinedAt", () => {
    const result = dedupePresenceMembers([
      { userId: "a", name: "Ada", joinedAt: "2026-01-01T00:00:00.000Z" },
      { userId: "a", name: "Ada", joinedAt: "2026-01-02T00:00:00.000Z", avatarUrl: "https://x/a.png" },
      { userId: "b", name: "Bob", joinedAt: "2026-01-01T12:00:00.000Z" },
    ]);

    expect(result).toEqual([
      { userId: "b", name: "Bob", joinedAt: "2026-01-01T12:00:00.000Z" },
      {
        userId: "a",
        name: "Ada",
        joinedAt: "2026-01-02T00:00:00.000Z",
        avatarUrl: "https://x/a.png",
      },
    ]);
  });

  it("returns an empty list unchanged", () => {
    expect(dedupePresenceMembers([])).toEqual([]);
  });
});
