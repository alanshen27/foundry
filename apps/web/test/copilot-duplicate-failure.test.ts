import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  deduplicateAssistantFailures,
  markFailedAssistantMessages,
  mergeTranscriptPreferringUserTurns,
} from "@/lib/copilot/messages";

function message(
  id: string,
  role: UIMessage["role"],
  text: string,
  parts: UIMessage["parts"] = [],
): UIMessage {
  return { id, role, parts: [{ type: "text", text }, ...parts] };
}
const user = message("u1", "user", "continue @AI");
const failure = "Failed: A provider item is missing its required reasoning item.";
const worker = message("assistant_run1", "assistant", failure);
const synthetic = message("fail_u1", "assistant", failure);

function failureLabels(messages: UIMessage[]): string[] {
  return messages.flatMap((entry) =>
    entry.parts.flatMap((part) =>
      part.type === "text" && part.text.startsWith("Failed: ") ? [part.text] : [],
    ),
  );
}

describe("one failure notice per user turn", () => {
  it("uses the accepted run's canonical reply ID when the stream fails before an assistant exists", () => {
    const result = markFailedAssistantMessages([user], "boom", "assistant_run1");
    expect(result.map((entry) => entry.id)).toEqual(["u1", "assistant_run1"]);
    expect(result[0]).toBe(user);
  });

  it("merges the worker reply and a racing client safety-net reply into one notice", () => {
    const firstClientFailure = markFailedAssistantMessages(
      [user],
      failure.slice("Failed: ".length),
    );
    const merged = mergeTranscriptPreferringUserTurns([user, worker], firstClientFailure);
    expect(merged.map((entry) => entry.id)).toEqual(["u1", "assistant_run1"]);
    expect(failureLabels(merged)).toEqual([failure]);
  });

  it("hides already-persisted duplicate notices after reload, preserving the worker ID regardless of row order", () => {
    for (const history of [
      [user, worker, synthetic],
      [user, synthetic, worker],
    ]) {
      const merged = mergeTranscriptPreferringUserTurns(history, []);
      expect(merged.map((entry) => entry.id)).toEqual(["u1", "assistant_run1"]);
      expect(history).toHaveLength(3);
      expect(synthetic.parts).toEqual([{ type: "text", text: failure }]);
    }
  });

  it("retains useful text and completed tools when removing a duplicate failure part", () => {
    const tool = {
      type: "tool-build",
      toolCallId: "t1",
      state: "output-available",
      input: {},
      output: { partId: "saved" },
    } as UIMessage["parts"][number];
    const client = message("fail_u1", "assistant", failure, [
      { type: "text", text: "Saved the part." },
      tool,
    ]);
    const merged = mergeTranscriptPreferringUserTurns([user, worker], [user, client]);
    expect(failureLabels(merged)).toEqual([failure]);
    expect(merged.find((entry) => entry.id === "fail_u1")!.parts).toEqual([
      { type: "text", text: "Saved the part." },
      tool,
    ]);
  });

  it("keeps identical failures attached to different user turns", () => {
    const history = [
      user,
      worker,
      message("u2", "user", "retry @AI"),
      message("assistant_run2", "assistant", failure),
    ];
    expect(deduplicateAssistantFailures(history)).toBe(history);
    expect(failureLabels(history)).toEqual([failure, failure]);
  });

  it("recognizes a late synthetic write by its original user ID after a newer turn", () => {
    const newer = message("u2", "user", "retry @AI");
    const nextFailure = message("assistant_run2", "assistant", "Failed: Another error");
    const history = [user, worker, newer, nextFailure, synthetic];
    const merged = mergeTranscriptPreferringUserTurns(history, []);
    expect(merged.map((entry) => entry.id)).toEqual([
      "u1",
      "assistant_run1",
      "u2",
      "assistant_run2",
    ]);
    expect(failureLabels(merged)).toEqual([failure, "Failed: Another error"]);
  });

  it("does not combine different errors or messages without a known user-turn boundary", () => {
    const different = [
      user,
      worker,
      message("assistant_other", "assistant", "Failed: Another error"),
    ];
    expect(deduplicateAssistantFailures(different)).toBe(different);
    const clipped = [worker, synthetic];
    expect(deduplicateAssistantFailures(clipped)).toBe(clipped);
  });

  it("removes repeated identical failure text within a single assistant message", () => {
    const repeated = message("assistant_run1", "assistant", failure, [
      { type: "text", text: failure },
    ]);
    expect(deduplicateAssistantFailures([user, repeated])[1]!.parts).toEqual([
      { type: "text", text: failure },
    ]);
  });

  it("repeated failure callbacks keep the same canonical reply and one notice", () => {
    const once = markFailedAssistantMessages([user], "boom", "assistant_run1");
    const twice = markFailedAssistantMessages(once, "boom", "assistant_run1");
    expect(twice.map((entry) => entry.id)).toEqual(["u1", "assistant_run1"]);
    expect(failureLabels(twice)).toEqual(["Failed: boom"]);
  });
});
