"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { CadProgressStore } from "@/lib/copilot/cad-progress-store";
import type { CadProgress } from "@/lib/copilot/cad-progress";

const CadProgressContext = createContext<CadProgressStore | null>(null);

export const CadProgressProvider = CadProgressContext.Provider;

/**
 * Live progress for one tool call. Returns undefined outside a provider (tool
 * rows also render in previews) or before the first update arrives.
 */
export function useCadProgress(toolCallId: string | undefined): CadProgress | undefined {
  const store = useContext(CadProgressContext);
  return useSyncExternalStore(
    (listener) => (store && toolCallId ? store.subscribe(toolCallId, listener) : () => undefined),
    () => (store && toolCallId ? store.get(toolCallId) : undefined),
    () => undefined,
  );
}
