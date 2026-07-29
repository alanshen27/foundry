/**
 * Map Zoo engine entity IDs → human labels for viewport hover chips.
 * After KCL execute we name solid3d bodies from script bindings (best-effort
 * creation order); hover walks face/edge parents up to a named solid.
 */
import type { ModelingCmd } from "@kittycad/lib";
import { listCadSolids } from "./tools";

export type ModelingCmdResult = {
  type: string;
  data?: unknown;
};

/** Pull OkModelingCmdResponse out of a Zoo websocket send() result. */
export function modelingCmdFromSendResult(result: unknown): ModelingCmdResult | null {
  if (!result || typeof result !== "object") return null;
  const root = result as Record<string, unknown>;
  if (root.success === false) return null;
  const resp = root.resp as Record<string, unknown> | undefined;
  if (!resp || resp.type !== "modeling") return null;
  const data = resp.data as { modeling_response?: ModelingCmdResult } | undefined;
  const mr = data?.modeling_response;
  if (!mr || typeof mr !== "object" || typeof mr.type !== "string") return null;
  return mr;
}

export function entityIdFromHighlight(result: unknown): string | null {
  const mr = modelingCmdFromSendResult(result);
  if (!mr || mr.type !== "highlight_set_entity") return null;
  const data = mr.data as { entity_id?: string } | undefined;
  const id = data?.entity_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function solidIdsFromSceneGet(result: unknown): string[] {
  const mr = modelingCmdFromSendResult(result);
  if (!mr || mr.type !== "scene_get_entity_ids") return [];
  const data = mr.data as { entity_ids?: string[][] } | undefined;
  const groups = data?.entity_ids;
  if (!Array.isArray(groups)) return [];
  const out: string[] = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const id of group) {
      if (typeof id === "string" && id) out.push(id);
    }
  }
  return out;
}

export function entityTypeFromResult(result: unknown): string | null {
  const mr = modelingCmdFromSendResult(result);
  if (!mr || mr.type !== "get_entity_type") return null;
  const data = mr.data as { entity_type?: string } | undefined;
  return typeof data?.entity_type === "string" ? data.entity_type : null;
}

export function parentIdFromResult(result: unknown): string | null {
  const mr = modelingCmdFromSendResult(result);
  if (!mr || mr.type !== "entity_get_parent_id") return null;
  const data = mr.data as { entity_id?: string } | undefined;
  const id = data?.entity_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Pair solid3d engine IDs with KCL solid names (source order ≈ creation order). */
export function pairSolidNames(script: string, solidIds: string[]): Map<string, string> {
  const names = listCadSolids(script);
  const map = new Map<string, string>();
  const n = Math.min(names.length, solidIds.length);
  for (let i = 0; i < n; i++) {
    map.set(solidIds[i]!, names[i]!);
  }
  return map;
}

export function prettyEntityType(entityType: string | null | undefined): string {
  switch (entityType) {
    case "solid3d":
      return "Solid";
    case "solid2d":
      return "Sketch";
    case "face":
      return "Face";
    case "edge":
      return "Edge";
    case "vertex":
      return "Vertex";
    case "path":
    case "segment":
    case "curve":
      return "Curve";
    default:
      return "Part";
  }
}

export type SendModeling = (cmd: ModelingCmd) => Promise<unknown>;

/**
 * Walk parents until a named solid is found (or type solid3d). Caps depth so a
 * bad graph can't loop.
 */
export async function resolveHoverLabel(
  entityId: string,
  solidNames: Map<string, string>,
  send: SendModeling,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(entityId)) return cache.get(entityId) ?? null;

  let current: string | null = entityId;
  const seen = new Set<string>();
  for (let depth = 0; depth < 12 && current; depth++) {
    if (seen.has(current)) break;
    seen.add(current);

    const named = solidNames.get(current);
    if (named) {
      cache.set(entityId, named);
      return named;
    }

    let entityType: string | null = null;
    try {
      entityType = entityTypeFromResult(await send({ type: "get_entity_type", entity_id: current }));
    } catch {
      break;
    }

    if (entityType === "solid3d") {
      const fallback = prettyEntityType("solid3d");
      cache.set(entityId, fallback);
      return fallback;
    }

    let parent: string | null = null;
    try {
      parent = parentIdFromResult(await send({ type: "entity_get_parent_id", entity_id: current }));
    } catch {
      break;
    }
    if (!parent || parent === current) {
      const label = prettyEntityType(entityType);
      cache.set(entityId, label);
      return label;
    }
    current = parent;
  }

  cache.set(entityId, null);
  return null;
}

export function sceneGetSolidIdsCmd(take = 100): ModelingCmd {
  return {
    type: "scene_get_entity_ids",
    filter: ["solid3d"],
    skip: 0,
    take: Math.min(1000, Math.max(1, take)),
  };
}
