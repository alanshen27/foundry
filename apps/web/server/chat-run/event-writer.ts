import type { UIMessageChunk } from "ai";

export type RunEventWrite = { seq: number; chunk: UIMessageChunk };

function snapshotKey(chunk: UIMessageChunk): string | null {
  if (
    (chunk.type !== "data-cad-draft" && chunk.type !== "data-cad-progress") ||
    !("transient" in chunk) ||
    !chunk.transient ||
    !chunk.data ||
    typeof chunk.data !== "object"
  )
    return null;
  const data = chunk.data as Record<string, unknown>;
  if (typeof data.toolCallId !== "string" || data.clear === true) return null;
  return JSON.stringify([chunk.type, data.toolCallId, data.path ?? ""]);
}

/**
 * One ordered durable queue, with short batches and bounded backpressure.
 * Full display snapshots can replace older pending snapshots; model deltas,
 * tool results, and draft clears remain ordered and are never dropped.
 */
export function createRunEventWriter(options: {
  initialSeq: number;
  persist: (events: RunEventWrite[]) => Promise<void>;
  onError?: (error: unknown) => void;
  flushIntervalMs?: number;
  batchSize?: number;
  bufferLimit?: number;
}) {
  const interval = options.flushIntervalMs ?? 40;
  const batchSize = options.batchSize ?? 64;
  const bufferLimit = options.bufferLimit ?? 256;
  let seq = options.initialSeq;
  let pending: UIMessageChunk[] = [];
  let writing: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failed = false;
  let failure: unknown;
  let closed = false;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    if (timer || writing || pending.length === 0 || failed || closed) return;
    timer = setTimeout(() => {
      timer = null;
      void flush().catch(() => undefined);
    }, interval);
    timer.unref?.();
  }

  function startWrite(): Promise<void> | null {
    if (writing || pending.length === 0 || failed) return writing;
    const events = pending.splice(0, batchSize).map((chunk) => ({ seq: ++seq, chunk }));
    writing = Promise.resolve()
      .then(() => options.persist(events))
      .then(
        () => {
          writing = null;
          schedule();
        },
        (error) => {
          failed = true;
          failure = error;
          writing = null;
          // A tool can be silent for minutes. Notify its owner immediately
          // instead of waiting for another model chunk to discover failure.
          try {
            options.onError?.(error);
          } catch {
            /* Preserve the persistence error. */
          }
          throw error;
        },
      );
    return writing;
  }

  async function flush(): Promise<void> {
    clearTimer();
    while (writing || pending.length > 0) {
      if (failed) throw failure;
      const current = writing ?? startWrite();
      if (current) await current;
      clearTimer();
    }
    if (failed) throw failure;
  }

  function enqueue(chunk: UIMessageChunk): Promise<void> {
    if (closed) return Promise.reject(new Error("Chat event writer is closed"));
    if (failed) return Promise.reject(failure);
    const key = snapshotKey(chunk);
    if (key) {
      for (let index = pending.length - 1; index >= 0; index--) {
        const previousKey = snapshotKey(pending[index]!);
        // A durable event or clear is a boundary; do not reorder across it.
        if (!previousKey) break;
        if (previousKey === key) {
          pending.splice(index, 1);
          break;
        }
      }
    }
    if (key && pending.length >= bufferLimit) {
      // Progress producers do not await enqueue. Keep their large snapshots
      // bounded even while the database stalls, preserving durable events.
      const replaceable = pending.findIndex((event) => snapshotKey(event) !== null);
      if (replaceable >= 0) pending.splice(replaceable, 1);
      else return Promise.resolve();
    }
    // Small lifecycle clears are admitted in order like durable chunks;
    // they must not be deferred behind a tool result or lost during close.
    pending.push(chunk);
    if (pending.length >= bufferLimit && !key) return flush();
    if (pending.length >= batchSize && !writing) {
      clearTimer();
      void startWrite()?.catch(() => undefined);
    } else schedule();
    return Promise.resolve();
  }

  return {
    enqueue,
    flush,
    /** On abort the client clears every preview; keep only durable run events. */
    discardTransient() {
      pending = pending.filter(
        (chunk) =>
          !(
            (chunk.type === "data-cad-draft" || chunk.type === "data-cad-progress") &&
            "transient" in chunk &&
            chunk.transient
          ),
      );
    },
    async close(): Promise<void> {
      closed = true;
      await flush();
    },
  };
}
