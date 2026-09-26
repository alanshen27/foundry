import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";
import { createRunEventWriter, type RunEventWrite } from "@/server/chat-run/event-writer";

const draft = (content: string): UIMessageChunk => ({
  type: "data-cad-draft",
  transient: true,
  data: { toolCallId: "cad", path: "parts/base.kcl", content, clear: false, truncated: false },
});
const delta = (text: string): UIMessageChunk => ({ type: "text-delta", id: "text", delta: text });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

describe("ordered chat event batches", () => {
  it("persists a burst in batches rather than waiting for each chunk", async () => {
    const persist = vi.fn(async (_events: RunEventWrite[]) => {});
    const writer = createRunEventWriter({ initialSeq: 4, persist });
    for (let index = 0; index < 30; index++) await writer.enqueue(delta(String(index)));
    expect(persist).not.toHaveBeenCalled();
    await writer.close();
    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0]![0].map((event) => event.seq)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 5),
    );
    expect(persist.mock.calls[0]![0].map((event) => event.chunk)).toEqual(
      Array.from({ length: 30 }, (_, index) => delta(String(index))),
    );
  });

  it("flushes a live stream promptly even when its next tool is slow", async () => {
    vi.useFakeTimers();
    const persist = vi.fn(async (_events: RunEventWrite[]) => {});
    const writer = createRunEventWriter({ initialSeq: 0, persist });
    await writer.enqueue({
      type: "tool-input-available",
      toolCallId: "cad",
      toolName: "text_to_cad",
      input: {},
    });
    await vi.advanceTimersByTimeAsync(40);
    expect(persist).toHaveBeenCalledOnce();
    await writer.close();
  });

  it("coalesces queued display snapshots while preserving tool boundaries and contiguous sequence IDs", async () => {
    const persisted: RunEventWrite[] = [];
    const writer = createRunEventWriter({
      initialSeq: 0,
      persist: async (events) => {
        persisted.push(...events);
      },
    });
    await writer.enqueue(draft("old"));
    await writer.enqueue(draft("latest"));
    const result: UIMessageChunk = {
      type: "tool-output-available",
      toolCallId: "cad",
      output: { ok: true },
    };
    await writer.enqueue(result);
    await writer.enqueue(draft("next step"));
    await writer.close();
    expect(persisted.map((event) => event.chunk)).toEqual([
      draft("latest"),
      result,
      draft("next step"),
    ]);
    expect(persisted.map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it("never publishes a later batch ahead of an earlier database write", async () => {
    const first = deferred();
    const persisted: RunEventWrite[] = [];
    const persist = vi.fn(async (events: RunEventWrite[]) => {
      if (events[0]!.seq === 1) await first.promise;
      persisted.push(...events);
    });
    const writer = createRunEventWriter({ initialSeq: 0, persist, batchSize: 2 });
    for (const text of ["a", "b", "c", "d"]) await writer.enqueue(delta(text));
    const closing = writer.close();
    expect(persist).toHaveBeenCalledOnce();
    expect(persisted).toEqual([]);
    first.resolve();
    await closing;
    expect(persisted.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
  });

  it("drops pending preview snapshots on stop while retaining tool inputs and results", async () => {
    const persisted: RunEventWrite[] = [];
    const writer = createRunEventWriter({
      initialSeq: 0,
      persist: async (events) => {
        persisted.push(...events);
      },
    });
    const input: UIMessageChunk = {
      type: "tool-input-available",
      toolCallId: "cad",
      toolName: "text_to_cad",
      input: {},
    };
    const result: UIMessageChunk = {
      type: "tool-output-available",
      toolCallId: "done",
      output: { saved: true },
    };
    await writer.enqueue(input);
    await writer.enqueue(draft("pending"));
    await writer.enqueue(result);
    writer.discardTransient();
    await writer.close();
    expect(persisted.map((event) => event.chunk)).toEqual([input, result]);
    expect(persisted.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("applies backpressure when the bounded buffer fills", async () => {
    const first = deferred();
    const persist = vi.fn(async (_events: RunEventWrite[]) => first.promise);
    const writer = createRunEventWriter({ initialSeq: 0, persist, batchSize: 2, bufferLimit: 2 });
    await writer.enqueue(delta("a"));
    let drained = false;
    const full = writer.enqueue(delta("b")).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    first.resolve();
    await full;
    expect(drained).toBe(true);
    await writer.close();
  });

  it("surfaces a failed batch and refuses later sequence writes", async () => {
    const persist = vi.fn(async (_events: RunEventWrite[]) => {
      throw new Error("database unavailable");
    });
    const writer = createRunEventWriter({ initialSeq: 0, persist });
    await writer.enqueue(delta("a"));
    await expect(writer.flush()).rejects.toThrow("database unavailable");
    await expect(writer.enqueue(delta("b"))).rejects.toThrow("database unavailable");
    await expect(writer.close()).rejects.toThrow("database unavailable");
    expect(persist).toHaveBeenCalledOnce();
  });

  it("bounds fire-and-forget snapshots during a stalled write and keeps lifecycle clears in order", async () => {
    const first = deferred();
    const persisted: RunEventWrite[] = [];
    const writer = createRunEventWriter({
      initialSeq: 0,
      batchSize: 1,
      bufferLimit: 4,
      persist: async (events) => {
        await first.promise;
        persisted.push(...events);
      },
    });
    await writer.enqueue(delta("before"));
    const pending: Promise<void>[] = [];
    for (let index = 0; index < 1000; index++) {
      pending.push(
        writer.enqueue({
          type: "data-cad-draft",
          transient: true,
          data: { toolCallId: `tool-${index}`, path: "main.kcl", content: "x".repeat(1000) },
        }),
      );
    }
    const clear: UIMessageChunk = {
      type: "data-cad-draft",
      transient: true,
      data: { toolCallId: "tool-999", clear: true },
    };
    pending.push(writer.enqueue(clear));
    pending.push(writer.enqueue(delta("after")));
    const closing = writer.close();
    first.resolve();
    await Promise.all([...pending, closing]);
    expect(persisted).toHaveLength(7);
    expect(persisted[0]!.chunk).toEqual(delta("before"));
    expect(persisted.at(-2)!.chunk).toEqual(clear);
    expect(persisted.at(-1)!.chunk).toEqual(delta("after"));
    expect(persisted.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("reports a timer-driven failure immediately without awaiting another chunk", async () => {
    vi.useFakeTimers();
    const failure = new Error("database unavailable");
    const onError = vi.fn();
    const writer = createRunEventWriter({
      initialSeq: 0,
      onError,
      persist: async () => {
        throw failure;
      },
    });
    await writer.enqueue(delta("before slow tool"));
    await vi.advanceTimersByTimeAsync(40);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
    await expect(writer.close()).rejects.toBe(failure);
  });
});
