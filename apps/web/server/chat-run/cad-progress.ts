import "server-only";

import type { UIMessageChunk } from "ai";
import {
  cadProgressChunk,
  trimNote,
  type CadProgress,
  type CadProgressPhase,
} from "@/lib/copilot/cad-progress";

export type CadProgressUpdate = {
  toolCallId: string;
  phase: CadProgressPhase;
  note?: string;
};

/** Narration can arrive per token; one chunk per tool call per window. */
const NOTE_THROTTLE_MS = 1_200;

export type CadProgressEmitter = (update: CadProgressUpdate) => void;

/**
 * Turn tool-side progress into stream chunks.
 *
 * Phase changes always publish; notes are throttled so a chatty generation
 * can't write thousands of run events. `startedAt` is stamped once per tool
 * call so the client owns the ticking clock.
 */
export function createCadProgressEmitter(publish: (chunk: UIMessageChunk) => void): {
  emit: CadProgressEmitter;
  /** Drop bookkeeping for a finished tool call. */
  end: (toolCallId: string) => void;
} {
  const state = new Map<string, { startedAt: number; phase: CadProgressPhase; lastAt: number }>();

  return {
    emit(update) {
      const now = Date.now();
      const prev = state.get(update.toolCallId);
      const startedAt = prev?.startedAt ?? now;
      const phaseChanged = prev?.phase !== update.phase;
      if (prev && !phaseChanged && now - prev.lastAt < NOTE_THROTTLE_MS) return;
      state.set(update.toolCallId, { startedAt, phase: update.phase, lastAt: now });

      const progress: CadProgress = {
        toolCallId: update.toolCallId,
        phase: update.phase,
        startedAt,
        ...(update.note?.trim() ? { note: trimNote(update.note) } : {}),
      };
      publish(cadProgressChunk(progress));
    },
    end(toolCallId) {
      state.delete(toolCallId);
    },
  };
}
