/**
 * Cache exploded-scene projects by CadDoc mtime + hover focus so list-hover
 * lifts don't rebuild the whole file map every frame — only the entry script.
 */
import type { CadDoc } from "@/lib/cad/engine";
import { buildExplodedScene, type ExplodedScene } from "@/lib/cad/exploded-scene";

type Entry = {
  key: string;
  base: ExplodedScene | null;
};

const cache = new Map<string, Entry>();

export function explodedCacheKey(scope: string, modelUpdatedAt: string | null | undefined): string {
  return `ex1|${scope}|m:${modelUpdatedAt ?? "none"}`;
}

export function getCachedExplodedScene(
  scope: string,
  modelUpdatedAt: string | null | undefined,
  cad: CadDoc | null,
  focusPartId?: string | null,
): ExplodedScene | null {
  const key = explodedCacheKey(scope, modelUpdatedAt);
  let hit = cache.get(scope);
  if (!hit || hit.key !== key) {
    const base = buildExplodedScene(cad, { focusPartId: null });
    hit = { key, base };
    cache.set(scope, hit);
  }
  if (!hit.base) return null;
  if (!focusPartId) return hit.base;
  // Hover only changes the entry script / translates — rebuild lightly.
  return buildExplodedScene(cad, { focusPartId });
}

export function clearExplodedSceneCache(): void {
  cache.clear();
}
