import { z } from "zod";
import type { UIMessageChunk } from "ai";

export const CAD_DRAFT_LIMIT = 100_000;
export const cadDraftSchema = z.discriminatedUnion("clear", [
  z.object({ toolCallId: z.string().min(1), clear: z.literal(true) }),
  z.object({
    toolCallId: z.string().min(1),
    clear: z.literal(false),
    path: z.string().min(1).max(300),
    content: z.string().max(CAD_DRAFT_LIMIT),
    truncated: z.boolean(),
  }),
]);
export type CadDraft = z.infer<typeof cadDraftSchema>;
export type CadSourceDraft = Extract<CadDraft, { clear: false }>;
export function cadDraftChunk(data: CadDraft): UIMessageChunk {
  return { type: "data-cad-draft", data, transient: true } as UIMessageChunk;
}
export function readCadDraft(chunk: unknown): CadDraft | null {
  if (!chunk || typeof chunk !== "object") return null;
  const candidate = chunk as { type?: unknown; data?: unknown };
  if (candidate.type !== "data-cad-draft") return null;
  const parsed = cadDraftSchema.safeParse(candidate.data);
  return parsed.success ? parsed.data : null;
}

/** Stable snapshots for all live CAD tools, with bounded transient memory. */
export class CadDraftStore {
  private drafts: CadSourceDraft[] = [];
  private listeners = new Set<() => void>();
  get = () => this.drafts;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  set(update: CadDraft) {
    this.drafts = this.drafts.filter(
      (draft) =>
        draft.toolCallId !== update.toolCallId || (!update.clear && draft.path !== update.path),
    );
    if (!update.clear) this.drafts = [...this.drafts.slice(-11), update];
    this.listeners.forEach((listener) => listener());
  }
  clearAll() {
    this.drafts = [];
    this.listeners.forEach((listener) => listener());
  }
}
