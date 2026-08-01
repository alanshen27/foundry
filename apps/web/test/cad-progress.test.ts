import { describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";
import {
  CAD_PROGRESS_CHUNK_TYPE,
  cadProgressChunk,
  formatElapsed,
  readCadProgress,
  trimNote,
} from "@/lib/copilot/cad-progress";
import { CadProgressStore } from "@/lib/copilot/cad-progress-store";
import { createCadProgressEmitter } from "@/server/chat-run/cad-progress";

describe("cad progress chunks", () => {
  it("round-trips a progress update as a transient data chunk", () => {
    const chunk = cadProgressChunk({
      toolCallId: "call_1",
      phase: "generate",
      note: "Sketching the profile",
      startedAt: 1_700_000_000_000,
    });

    expect(chunk).toMatchObject({
      type: CAD_PROGRESS_CHUNK_TYPE,
      id: "call_1",
      transient: true,
    });
    expect(readCadProgress(chunk)?.note).toBe("Sketching the profile");
  });

  it("ignores unrelated or malformed chunks", () => {
    expect(readCadProgress({ type: "text-delta", delta: "hi", id: "1" })).toBeNull();
    expect(readCadProgress(null)).toBeNull();
    expect(readCadProgress({ type: CAD_PROGRESS_CHUNK_TYPE, data: { phase: "orbit" } })).toBeNull();
  });

  it("formats elapsed time for a row that ticks every second", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(48_000)).toBe("48s");
    expect(formatElapsed(134_000)).toBe("2m 14s");
  });

  it("collapses long narration to one line", () => {
    expect(trimNote("  writing\n  main.kcl  ")).toBe("writing main.kcl");
    expect(trimNote("x".repeat(400))).toHaveLength(300);
  });
});

describe("createCadProgressEmitter", () => {
  it("publishes phase changes immediately and throttles notes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const chunks: UIMessageChunk[] = [];
    const { emit } = createCadProgressEmitter((chunk) => chunks.push(chunk));

    emit({ toolCallId: "call_1", phase: "generate" });
    emit({ toolCallId: "call_1", phase: "generate", note: "too soon" });
    vi.advanceTimersByTime(1_500);
    emit({ toolCallId: "call_1", phase: "generate", note: "writing main.kcl" });
    emit({ toolCallId: "call_1", phase: "snapshot", note: "rendering" });

    expect(chunks.map((c) => readCadProgress(c)?.note)).toEqual([
      undefined,
      "writing main.kcl",
      "rendering",
    ]);
    vi.useRealTimers();
  });

  it("keeps one start time per tool call so the client clock is stable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const chunks: UIMessageChunk[] = [];
    const { emit, end } = createCadProgressEmitter((chunk) => chunks.push(chunk));

    emit({ toolCallId: "call_1", phase: "generate" });
    const startedAt = readCadProgress(chunks[0])?.startedAt;
    vi.advanceTimersByTime(30_000);
    emit({ toolCallId: "call_1", phase: "execute" });
    expect(readCadProgress(chunks[1])?.startedAt).toBe(startedAt);

    // A later call with the same id (new tool call) starts its own clock.
    end("call_1");
    emit({ toolCallId: "call_1", phase: "generate" });
    expect(readCadProgress(chunks[2])?.startedAt).toBe((startedAt ?? 0) + 30_000);
    vi.useRealTimers();
  });
});

describe("CadProgressStore", () => {
  it("notifies only the subscribed tool call", () => {
    const store = new CadProgressStore();
    const mine = vi.fn();
    const other = vi.fn();
    store.subscribe("call_1", mine);
    store.subscribe("call_2", other);

    store.set({ toolCallId: "call_1", phase: "generate", startedAt: 1 });

    expect(mine).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(store.get("call_1")?.phase).toBe("generate");
  });

  it("skips identical updates so rows don't re-render on repeats", () => {
    const store = new CadProgressStore();
    const listener = vi.fn();
    store.subscribe("call_1", listener);
    const progress = { toolCallId: "call_1", phase: "generate", startedAt: 1 } as const;

    store.set({ ...progress });
    store.set({ ...progress });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clears every row when the run ends", () => {
    const store = new CadProgressStore();
    const listener = vi.fn();
    store.subscribe("call_1", listener);
    store.set({ toolCallId: "call_1", phase: "generate", startedAt: 1 });

    store.clearAll();

    expect(store.get("call_1")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
