import { createClient } from "@supabase/supabase-js";
import { CURSOR_STALE_MS, type CursorHandle, type CursorPort, type CursorState } from "./cursors";

export type SupabaseCursorConfig = {
  url: string;
  anonKey: string;
};

/**
 * Browser-to-browser cursor broadcast over Supabase Realtime.
 *
 * Unlike the copilot's broadcast port, this both sends and receives from the
 * client: cursor traffic never needs to reach the server, so routing it
 * through one would add a hop and a service-role credential for data that is
 * discarded within seconds.
 */
export function createSupabaseCursorPort(config: SupabaseCursorConfig): CursorPort {
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false },
  });

  return {
    join(channel, self, onPeers): CursorHandle {
      const peers = new Map<string, CursorState>();
      // `self: false` keeps our own cursor out of the echo, so the local
      // pointer is never drawn twice.
      const room = client.channel(channel, { config: { broadcast: { self: false } } });
      let subscribed = false;
      let queued: { x: number; y: number } | null = null;

      const emit = () => {
        const now = Date.now();
        for (const [id, peer] of peers) {
          if (now - peer.at > CURSOR_STALE_MS) peers.delete(id);
        }
        onPeers([...peers.values()]);
      };

      const sendMove = (x: number, y: number) => {
        void room.send({
          type: "broadcast",
          event: "cursor",
          payload: { ...self, x, y, at: Date.now() } satisfies CursorState,
        });
      };

      room.on("broadcast", { event: "cursor" }, ({ payload }) => {
        const peer = payload as CursorState;
        if (!peer?.userId || peer.userId === self.userId) return;
        peers.set(peer.userId, peer);
        emit();
      });

      room.on("broadcast", { event: "cursor-leave" }, ({ payload }) => {
        const { userId } = (payload ?? {}) as { userId?: string };
        if (!userId) return;
        peers.delete(userId);
        emit();
      });

      void room.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        subscribed = true;
        if (queued) {
          sendMove(queued.x, queued.y);
          queued = null;
        }
      });

      // A peer that stops moving still has a valid cursor, but one that closed
      // its tab does not — sweep so stale entries disappear without traffic.
      const sweep = setInterval(emit, CURSOR_STALE_MS);

      return {
        move: (x, y) => {
          if (!subscribed) {
            queued = { x, y };
            return;
          }
          sendMove(x, y);
        },
        leave: () => {
          clearInterval(sweep);
          void room.send({
            type: "broadcast",
            event: "cursor-leave",
            payload: { userId: self.userId },
          });
          void client.removeChannel(room);
        },
      };
    },
  };
}
