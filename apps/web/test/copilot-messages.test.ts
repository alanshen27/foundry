import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  ASSISTANT_FAILURE_PREFIX,
  markFailedAssistantMessages,
  mergeTranscriptPreferringUserTurns,
} from "@/lib/copilot/messages";

function msg(
  id: string,
  role: UIMessage["role"],
  text: string,
  extraParts: UIMessage["parts"] = [],
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }, ...extraParts],
  } as UIMessage;
}

describe("markFailedAssistantMessages", () => {
  it("stamps the last assistant turn", () => {
    const out = markFailedAssistantMessages(
      [msg("u1", "user", "hi"), msg("a1", "assistant", "Working…")],
      "boom",
    );
    expect(out).toHaveLength(2);
    const texts = out[1]!.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text);
    expect(texts.some((t) => t.startsWith(ASSISTANT_FAILURE_PREFIX) && t.includes("boom"))).toBe(
      true,
    );
  });

  it("appends a failed assistant when the transcript ends on a user turn", () => {
    const out = markFailedAssistantMessages([msg("u1", "user", "@AI assemble")], "timed out");
    expect(out).toHaveLength(2);
    expect(out[0]!.role).toBe("user");
    expect(out[0]!.parts).toEqual([{ type: "text", text: "@AI assemble" }]);
    expect(out[1]!.role).toBe("assistant");
    expect((out[1]!.parts[0] as { text: string }).text).toBe(
      `${ASSISTANT_FAILURE_PREFIX}timed out`,
    );
  });

  it("does not rewrite an older assistant when a newer user turn failed", () => {
    const out = markFailedAssistantMessages(
      [msg("u1", "user", "first"), msg("a1", "assistant", "ok"), msg("u2", "user", "retry")],
      "again",
    );
    expect(out).toHaveLength(4);
    expect(out[1]!.parts).toEqual([{ type: "text", text: "ok" }]);
    expect(out[3]!.role).toBe("assistant");
    expect((out[3]!.parts[0] as { text: string }).text).toContain("again");
  });
});

describe("mergeTranscriptPreferringUserTurns", () => {
  it("keeps local-only user turns that the client still holds", () => {
    const server = [msg("u1", "user", "old"), msg("a1", "assistant", "reply")];
    const local = [...server, msg("u2", "user", "just sent")];
    const merged = mergeTranscriptPreferringUserTurns(server, local);
    expect(merged.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("does not let an empty local stub wipe a stored user message", () => {
    const server = [msg("u1", "user", "keep me")];
    const local = [{ id: "u1", role: "user" as const, parts: [] }] as UIMessage[];
    const merged = mergeTranscriptPreferringUserTurns(server, local);
    expect((merged[0]!.parts[0] as { text: string }).text).toBe("keep me");
  });

  it("does not duplicate a user turn that already exists under a different id", () => {
    const server = [msg("u1", "user", "@AI assemble")];
    const local = [msg("local_user_1", "user", "@AI assemble")];
    const merged = mergeTranscriptPreferringUserTurns(server, local);
    expect(merged.map((m) => m.id)).toEqual(["u1"]);
  });
});
