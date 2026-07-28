import { describe, expect, it } from "vitest";
import {
  copilotBroadcastChannel,
  siteBroadcastChannel,
  sitePresenceChannel,
} from "../src/broadcast";
import { dedupePresenceMembers } from "../src/dedupe";
import { cursorChannel } from "../src/cursors";

describe("dedupePresenceMembers", () => {
  it("keeps one entry per userId, preferring the latest joinedAt", () => {
    const result = dedupePresenceMembers([
      { userId: "a", name: "Ada", joinedAt: "2026-01-01T00:00:00.000Z" },
      {
        userId: "a",
        name: "Ada",
        joinedAt: "2026-01-02T00:00:00.000Z",
        avatarUrl: "https://x/a.png",
      },
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

describe("broadcast channels", () => {
  it("keeps site generation isolated from copilot rooms", () => {
    expect(siteBroadcastChannel("site_1")).toBe("foundry:site:site_1");
    expect(copilotBroadcastChannel("channel_1")).toBe("foundry:copilot:channel_1");
  });

  it("scopes site presence separately from generation broadcast", () => {
    expect(sitePresenceChannel("site_1")).toBe("presence:site:site_1");
    expect(sitePresenceChannel("site_1")).not.toBe(siteBroadcastChannel("site_1"));
  });
});

describe("cursor channels", () => {
  it("scopes live cursors per project branch for CAD/PCB/schematic", () => {
    expect(cursorChannel("proj_1", "branch_1")).toBe("foundry:cursors:proj_1:branch_1");
  });
});
