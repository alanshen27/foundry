import type { CursorPort } from "./cursors";

/**
 * No-op cursors for NEXT_PUBLIC_REALTIME_MODE=off. Mirrors the other "off"
 * adapters: the feature disappears rather than erroring, so a local dev setup
 * without Supabase still runs the editor.
 */
export function createOffCursorPort(): CursorPort {
  return {
    join() {
      return { move: () => {}, leave: () => {} };
    },
  };
}
