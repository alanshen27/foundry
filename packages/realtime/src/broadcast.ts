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

/** Site generation events are scoped to one native site editor room. */
export function siteBroadcastChannel(siteId: string): string {
  return `foundry:site:${siteId}`;
}
