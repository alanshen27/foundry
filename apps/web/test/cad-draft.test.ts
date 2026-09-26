import { afterEach, describe, expect, it, vi } from "vitest";
import { CadDraftStore, readCadDraft, CAD_DRAFT_LIMIT } from "@/lib/copilot/cad-draft";
import { createCadDraftEmitter } from "@/server/chat-run/cad-draft";

afterEach(() => vi.useRealTimers());
describe("live draft transport", () => {
  it("throttles by file, caps source and clears every draft at tool completion", () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const emitter = createCadDraftEmitter(publish);
    emitter.emit({ toolCallId: "t", path: "a", content: "width=4" });
    emitter.emit({ toolCallId: "t", path: "a", content: "width=40" });
    emitter.emit({ toolCallId: "t", path: "b", content: "depth=20" });
    expect(publish).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(800);
    emitter.emit({ toolCallId: "t", path: "a", content: "x".repeat(CAD_DRAFT_LIMIT + 1) });
    const update = readCadDraft(publish.mock.calls[2]![0]);
    expect(update).toMatchObject({ clear: false, truncated: true });
    const store = new CadDraftStore();
    for (const [chunk] of publish.mock.calls) store.set(readCadDraft(chunk)!);
    expect(store.get()).toHaveLength(2);
    emitter.end("t");
    store.set(readCadDraft(publish.mock.lastCall![0])!);
    expect(store.get()).toEqual([]);
  });
  it("keeps independent tool drafts and rejects malformed event payloads", () => {
    const store = new CadDraftStore();
    store.set({ toolCallId: "one", path: "a", content: "draft", clear: false, truncated: false });
    store.set({ toolCallId: "two", path: "b", content: "draft", clear: false, truncated: false });
    store.set({ toolCallId: "one", clear: true });
    expect(store.get().map((d) => d.toolCallId)).toEqual(["two"]);
    expect(readCadDraft({ type: "data-cad-draft", data: { toolCallId: "t" } })).toBeNull();
  });
});
