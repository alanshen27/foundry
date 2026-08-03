import type { LiveEditPort } from "./live";

/**
 * No-op live editing for NEXT_PUBLIC_REALTIME_MODE=off. Mirrors the other
 * "off" adapters: the feature disappears rather than erroring.
 */
export function createOffLivePort(): LiveEditPort {
  return {
    join() {
      return {
        move: () => {},
        lock: () => {},
        unlock: () => {},
        commit: () => {},
        leave: () => {},
      };
    },
  };
}
