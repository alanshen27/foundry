/**
 * Supabase Realtime presence adapter (browser-side).
 */
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import type { PresenceHandle, PresenceMember, RealtimePort } from "./port";

export type SupabaseRealtimeConfig = {
  url: string;
  anonKey: string;
};

export function createSupabaseRealtimeAdapter(config: SupabaseRealtimeConfig): RealtimePort {
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false },
  });

  return {
    joinPresence(channel, self, onMembers): PresenceHandle {
      const room: RealtimeChannel = client.channel(channel, {
        config: { presence: { key: self.userId } },
      });

      room.on("presence", { event: "sync" }, () => {
        const state = room.presenceState<PresenceMember>();
        const members = Object.values(state)
          .flat()
          .map((entry) => ({
            userId: entry.userId,
            name: entry.name,
            joinedAt: entry.joinedAt,
          }));
        onMembers(members);
      });

      room.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await room.track(self);
        }
      });

      return {
        leave: () => {
          void room.untrack();
          void client.removeChannel(room);
        },
      };
    },
  };
}
