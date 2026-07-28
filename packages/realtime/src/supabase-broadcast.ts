import { createClient } from "@supabase/supabase-js";
import type { BroadcastPort, BroadcastPublisher, BroadcastSubscription } from "./broadcast";

export type SupabaseBroadcastConfig = {
  url: string;
  anonKey: string;
};

export type SupabaseBroadcastPublisherConfig = {
  url: string;
  serviceRoleKey: string;
};

/** Browser client: subscribe to Supabase Realtime broadcast events. */
export function createSupabaseBroadcastPort(config: SupabaseBroadcastConfig): BroadcastPort {
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false },
  });

  return {
    subscribe(channel, onMessage): BroadcastSubscription {
      const room = client.channel(channel);
      room.on("broadcast", { event: "*" }, ({ event, payload }) => {
        onMessage({ event, payload });
      });
      void room.subscribe();
      return {
        leave: () => {
          void client.removeChannel(room);
        },
      };
    },
  };
}

/** Server/worker: publish broadcast events with the service role key. */
export function createSupabaseBroadcastPublisher(
  config: SupabaseBroadcastPublisherConfig,
): BroadcastPublisher {
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async publish(channel, message) {
      const room = client.channel(channel);
      await new Promise<void>((resolve, reject) => {
        room.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            reject(new Error(`Supabase broadcast subscribe failed: ${status}`));
          }
        });
      });
      await room.send({
        type: "broadcast",
        event: message.event,
        payload: message.payload,
      });
      await client.removeChannel(room);
    },
  };
}
