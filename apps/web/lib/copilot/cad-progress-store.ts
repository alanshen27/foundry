import type { CadProgress } from "./cad-progress";

/**
 * Per-tool-call progress, kept out of React state on purpose: a Zoo turn emits
 * a note every second or so, and putting that in context would re-render the
 * whole transcript. Rows subscribe to their own tool call only.
 */
export class CadProgressStore {
  private readonly byToolCall = new Map<string, CadProgress>();
  private readonly listeners = new Map<string, Set<() => void>>();

  get(toolCallId: string): CadProgress | undefined {
    return this.byToolCall.get(toolCallId);
  }

  set(progress: CadProgress): void {
    const current = this.byToolCall.get(progress.toolCallId);
    if (
      current &&
      current.phase === progress.phase &&
      current.note === progress.note &&
      current.startedAt === progress.startedAt
    ) {
      return;
    }
    this.byToolCall.set(progress.toolCallId, progress);
    this.emit(progress.toolCallId);
  }

  clear(toolCallId: string): void {
    if (!this.byToolCall.delete(toolCallId)) return;
    this.emit(toolCallId);
  }

  /** Run over — drop every row's progress line. */
  clearAll(): void {
    const ids = [...this.byToolCall.keys()];
    this.byToolCall.clear();
    for (const id of ids) this.emit(id);
  }

  subscribe(toolCallId: string, listener: () => void): () => void {
    const set = this.listeners.get(toolCallId) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(toolCallId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(toolCallId);
    };
  }

  private emit(toolCallId: string): void {
    for (const listener of this.listeners.get(toolCallId) ?? []) listener();
  }
}
