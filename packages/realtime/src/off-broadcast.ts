import type { BroadcastPort, BroadcastPublisher } from "./broadcast";

/** No-op broadcast when realtime is off — SSE replay from DB still works. */
export function createOffBroadcastPort(): BroadcastPort {
  return {
    subscribe: () => ({ leave: () => {} }),
  };
}

export function createOffBroadcastPublisher(): BroadcastPublisher {
  return {
    async publish() {},
  };
}
