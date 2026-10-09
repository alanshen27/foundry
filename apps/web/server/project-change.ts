import "server-only";

import {
  PROJECT_CHANGED_EVENT,
  projectBroadcastChannel,
  type ProjectChange,
} from "@foundry/realtime";
import { createLogger } from "@foundry/observability";
import { getBroadcastPublisher } from "./realtime";

const log = createLogger("project-change");
const COALESCE_MS = 250;

type Pending = { changes: Map<string, ProjectChange>; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Pending>();

/**
 * Tells every open workspace on the branch that committed data changed, so
 * views that are not on a live Yjs room (collab server down, still connecting,
 * or local mode) refetch within a second instead of at the end of an AI run.
 *
 * Best-effort and never awaited by writers: a write is committed regardless.
 */
export function notifyProjectChanged(
  projectId: string,
  branchId: string,
  change: ProjectChange,
): void {
  const channel = projectBroadcastChannel(projectId, branchId);
  const key = change.kind === "code" ? "code" : `design:${change.design}`;
  const existing = pending.get(channel);
  if (existing) {
    existing.changes.set(key, change);
    return;
  }
  const entry: Pending = {
    changes: new Map([[key, change]]),
    timer: setTimeout(() => {
      pending.delete(channel);
      void getBroadcastPublisher()
        .publish(channel, {
          event: PROJECT_CHANGED_EVENT,
          payload: { changes: [...entry.changes.values()] },
        })
        .catch((err) => log.warn("project change broadcast failed", { err }));
    }, COALESCE_MS),
  };
  entry.timer.unref?.();
  pending.set(channel, entry);
}
