import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { shouldShowStandaloneChatError } from "@/lib/copilot/failure-banner";

function message(id: string, role: UIMessage["role"], text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}
const user = message("u1", "user", "continue @AI");
const error = new Error("An error occurred.");
const failure = message("assistant_run1", "assistant", "Failed: An error occurred.");

describe("standalone chat error banner", () => {
  it("does not repeat the same error already shown in the current assistant turn", () => {
    expect(shouldShowStandaloneChatError([user, failure], error)).toBe(false);
  });

  it("keeps an unsaved transport error visible when the turn has no failure notice", () => {
    expect(shouldShowStandaloneChatError([user], error)).toBe(true);
    expect(
      shouldShowStandaloneChatError([user, message("a1", "assistant", "Working…")], error),
    ).toBe(true);
  });

  it("keeps a new error visible even when a previous user turn failed identically", () => {
    expect(
      shouldShowStandaloneChatError([user, failure, message("u2", "user", "retry @AI")], error),
    ).toBe(true);
  });

  it("keeps distinct transport errors visible beside an existing model failure", () => {
    expect(shouldShowStandaloneChatError([user, failure], new Error("Failed to fetch"))).toBe(true);
  });

  it("does not use a delayed synthetic failure belonging to an older user turn", () => {
    expect(
      shouldShowStandaloneChatError(
        [
          user,
          message("u2", "user", "retry @AI"),
          message("fail_u1", "assistant", "Failed: An error occurred."),
        ],
        error,
      ),
    ).toBe(true);
  });

  it("does not hide errors based on deleted messages or unknown turn boundaries", () => {
    expect(
      shouldShowStandaloneChatError(
        [user, { ...failure, metadata: { deletedAt: new Date().toISOString() } }],
        error,
      ),
    ).toBe(true);
    expect(shouldShowStandaloneChatError([failure], error)).toBe(true);
  });

  it("has no standalone banner when there is no transport error", () => {
    expect(shouldShowStandaloneChatError([user, failure], undefined)).toBe(false);
  });
});
