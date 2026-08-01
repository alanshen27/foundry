/**
 * Live progress for long CAD tools (Zoo generation runs for minutes).
 *
 * Travels as a *transient* AI SDK data chunk on the normal run stream: the SDK
 * hands transient chunks to `onData` and never adds them to `message.parts`,
 * so progress reaches every attached client without polluting chat history.
 */
import { z } from "zod";
import type { UIMessageChunk } from "ai";

export const CAD_PROGRESS_CHUNK_TYPE = "data-cad-progress";

export const CAD_PROGRESS_PHASES = ["generate", "assemble", "execute", "snapshot"] as const;
export type CadProgressPhase = (typeof CAD_PROGRESS_PHASES)[number];

export const CAD_PHASE_LABEL: Record<CadProgressPhase, string> = {
  generate: "Generating on Zoo",
  assemble: "Assembling on Zoo",
  execute: "Executing KCL in the engine",
  snapshot: "Rendering views",
};

/** Longest note we forward — Zoo narration can be a whole paragraph. */
export const CAD_PROGRESS_NOTE_MAX = 300;

export const cadProgressSchema = z.object({
  toolCallId: z.string().min(1),
  phase: z.enum(CAD_PROGRESS_PHASES),
  /** Latest narration from Zoo (model reasoning, tool use, reconnects). */
  note: z.string().max(CAD_PROGRESS_NOTE_MAX).optional(),
  /** Epoch ms the tool started, so the client can tick elapsed on its own. */
  startedAt: z.number().int().positive(),
});

export type CadProgress = z.infer<typeof cadProgressSchema>;

export function cadProgressChunk(progress: CadProgress): UIMessageChunk {
  return {
    type: CAD_PROGRESS_CHUNK_TYPE,
    id: progress.toolCallId,
    data: progress,
    transient: true,
  } as UIMessageChunk;
}

/** Parse a stream chunk; returns null for anything that isn't CAD progress. */
export function readCadProgress(chunk: unknown): CadProgress | null {
  if (!chunk || typeof chunk !== "object") return null;
  const candidate = chunk as { type?: unknown; data?: unknown };
  if (candidate.type !== CAD_PROGRESS_CHUNK_TYPE) return null;
  const parsed = cadProgressSchema.safeParse(candidate.data);
  return parsed.success ? parsed.data : null;
}

/** Compact elapsed for a row that updates every second ("48s", "2m 14s"). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

/** Collapse Zoo narration to a single line that fits a tool row. */
export function trimNote(note: string): string {
  const flat = note.replace(/\s+/g, " ").trim();
  if (flat.length <= CAD_PROGRESS_NOTE_MAX) return flat;
  return `${flat.slice(0, CAD_PROGRESS_NOTE_MAX - 1)}…`;
}
