/** Lightweight broadcast channel for copilot stream fan-out. */
export type BroadcastMessage = {
  event: string;
  payload: unknown;
};

export type BroadcastSubscription = {
  leave: () => void;
};

/** Browser-side: subscribe to a named channel. */
export interface BroadcastPort {
  subscribe(channel: string, onMessage: (message: BroadcastMessage) => void): BroadcastSubscription;
}

/** Server/worker-side: publish to all subscribers on a channel. */
export interface BroadcastPublisher {
  publish(channel: string, message: BroadcastMessage): Promise<void>;
}

/** Copilot channels are scoped per project branch conversation. */
export function copilotBroadcastChannel(channelId: string): string {
  return `foundry:copilot:${channelId}`;
}

/**
 * Committed project writes, scoped per branch. Payloads name what changed,
 * never its content, so viewers refetch through their authorized API.
 */
export function projectBroadcastChannel(projectId: string, branchId: string): string {
  return `foundry:project:${projectId}:${branchId}`;
}

export const PROJECT_CHANGED_EVENT = "project-changed";

export type ProjectChange = { kind: "design"; design: string } | { kind: "code" };

export function readProjectChanges(payload: unknown): ProjectChange[] {
  const changes = (payload as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change): ProjectChange[] => {
    const c = change as { kind?: unknown; design?: unknown } | null;
    if (c?.kind === "code") return [{ kind: "code" }];
    if (c?.kind === "design" && typeof c.design === "string")
      return [{ kind: "design", design: c.design.slice(0, 40) }];
    return [];
  });
}

/** Site generation events are scoped to one native site editor room. */
export function siteBroadcastChannel(siteId: string): string {
  return `foundry:site:${siteId}`;
}

/** Who-is-here presence for a site editor (Supabase RealtimePort, not Yjs). */
export function sitePresenceChannel(siteId: string): string {
  return `presence:site:${siteId}`;
}
