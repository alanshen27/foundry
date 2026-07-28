/**
 * Memoize the synthesized Final Assembly project so Zoo isn't re-fed an
 * identical multi-file submit on every React render. Keyed by the MODEL3D +
 * PCB doc mtimes — any edit bumps those and drops the entry.
 */
import type { CadDoc } from "@/lib/cad/engine";
import type { PcbDoc } from "@/lib/pcb/doc";
import { buildFinalAssembly, type FinalAssembly } from "@/lib/cad/final-assembly";

type CacheEntry = {
  key: string;
  value: FinalAssembly | null;
};

const cache = new Map<string, CacheEntry>();

/** Bump when `buildFinalAssembly` output shape/semantics change so stale entries drop. */
const ASSEMBLY_CACHE_REV = 3;

export function assemblyCacheKey(
  scope: string,
  modelUpdatedAt: string | null | undefined,
  pcbUpdatedAt: string | null | undefined,
): string {
  return `v${ASSEMBLY_CACHE_REV}|${scope}|m:${modelUpdatedAt ?? "none"}|p:${pcbUpdatedAt ?? "none"}`;
}

export function getCachedFinalAssembly(
  scope: string,
  modelUpdatedAt: string | null | undefined,
  pcbUpdatedAt: string | null | undefined,
  cad: CadDoc | null,
  pcb: PcbDoc | null,
): FinalAssembly | null {
  const key = assemblyCacheKey(scope, modelUpdatedAt, pcbUpdatedAt);
  const hit = cache.get(scope);
  if (hit && hit.key === key) return hit.value;
  const value = buildFinalAssembly(cad, pcb);
  cache.set(scope, { key, value });
  return value;
}

/** Test helper — drop every cached assembly. */
export function clearFinalAssemblyCache(): void {
  cache.clear();
}
