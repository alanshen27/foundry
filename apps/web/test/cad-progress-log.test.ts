import { describe, expect, it } from "vitest";
import {
  CAD_PROGRESS_LOG_MAX,
  readToolProgressLog,
  type CadProgressLogEntry,
} from "@/lib/copilot/cad-progress";
import { CadProgressStore } from "@/lib/copilot/cad-progress-store";

describe("readToolProgressLog", () => {
  it("reads a valid progressLog off a tool output", () => {
    const entries: CadProgressLogEntry[] = [
      { at: 1000, phase: "generate" },
      { at: 2000, phase: "generate", note: "writing main.kcl" },
      { at: 3000, phase: "execute", note: "main: KCL executes clean" },
    ];
    expect(readToolProgressLog({ ok: true, progressLog: entries })).toEqual(entries);
  });

  it("returns [] for outputs without a log, malformed logs, and non-objects", () => {
    expect(readToolProgressLog({ ok: true })).toEqual([]);
    expect(readToolProgressLog({ progressLog: [{ at: "soon", phase: "generate" }] })).toEqual([]);
    expect(readToolProgressLog({ progressLog: [{ at: 1, phase: "teleport" }] })).toEqual([]);
    expect(readToolProgressLog(null)).toEqual([]);
    expect(readToolProgressLog("nope")).toEqual([]);
  });
});

describe("CadProgressStore log accumulation", () => {
  it("appends an entry per distinct phase/note update", () => {
    const store = new CadProgressStore();
    store.set({ toolCallId: "t1", phase: "generate", startedAt: 1 });
    store.set({ toolCallId: "t1", phase: "generate", note: "planning", startedAt: 1 });
    store.set({ toolCallId: "t1", phase: "execute", note: "verifying", startedAt: 1 });
    const log = store.getLog("t1");
    expect(log?.map((e) => [e.phase, e.note])).toEqual([
      ["generate", undefined],
      ["generate", "planning"],
      ["execute", "verifying"],
    ]);
  });

  it("does not duplicate identical consecutive updates", () => {
    const store = new CadProgressStore();
    store.set({ toolCallId: "t1", phase: "generate", note: "same", startedAt: 1 });
    store.set({ toolCallId: "t1", phase: "generate", note: "same", startedAt: 2 });
    expect(store.getLog("t1")).toHaveLength(1);
  });

  it("caps the log at CAD_PROGRESS_LOG_MAX, dropping oldest", () => {
    const store = new CadProgressStore();
    for (let i = 0; i < CAD_PROGRESS_LOG_MAX + 10; i++) {
      store.set({ toolCallId: "t1", phase: "generate", note: `n${i}`, startedAt: 1 });
    }
    const log = store.getLog("t1");
    expect(log).toHaveLength(CAD_PROGRESS_LOG_MAX);
    expect(log?.[0]?.note).toBe("n10");
    expect(log?.[log.length - 1]?.note).toBe(`n${CAD_PROGRESS_LOG_MAX + 9}`);
  });

  it("clears logs per call and on clearAll", () => {
    const store = new CadProgressStore();
    store.set({ toolCallId: "a", phase: "generate", startedAt: 1 });
    store.set({ toolCallId: "b", phase: "assemble", startedAt: 1 });
    store.clear("a");
    expect(store.getLog("a")).toBeUndefined();
    expect(store.getLog("b")).toHaveLength(1);
    store.clearAll();
    expect(store.getLog("b")).toBeUndefined();
  });
});
