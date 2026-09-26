"use client";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { CadDraftStore, CadSourceDraft } from "@/lib/copilot/cad-draft";
const Context = createContext<CadDraftStore | null>(null);
const EMPTY: CadSourceDraft[] = [];
export const CadDraftProvider = Context.Provider;
export function useCadDrafts() {
  const store = useContext(Context);
  return useSyncExternalStore(
    store?.subscribe ?? (() => () => undefined),
    store?.get ?? (() => EMPTY),
    () => EMPTY,
  );
}
