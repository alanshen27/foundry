import { createClient } from "@supabase/supabase-js";
import {
  LIVE_LOCK_TTL_MS,
  type LiveCommit,
  type LiveEditHandle,
  type LiveEditPort,
  type LiveLock,
  type LiveMove,
} from "./live";

export type SupabaseLiveConfig = {
  url: string;
  anonKey: string;
};

/**
 * Browser-to-browser live-edit broadcast over Supabase Realtime, mirroring the
 * cursor port: traffic never needs the server, and everything here is
 * discarded within seconds — the persisted document is still saved through the
 * normal tRPC mutations.
 */
export function createSupabaseLivePort(config: SupabaseLiveConfig): LiveEditPort {
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false },
  });

  return {
    join(channel, self, events): LiveEditHandle {
      const locks = new Map<string, LiveLock>();
      const room = client.channel(channel, { config: { broadcast: { self: false } } });
      let subscribed = false;
      const queued: { event: string; payload: unknown }[] = [];

      const lockKey = (surface: string, objectId: string) => `${surface}\u0000${objectId}`;

      const emitLocks = () => {
        const now = Date.now();
        for (const [key, lock] of locks) {
          if (now - lock.at > LIVE_LOCK_TTL_MS) locks.delete(key);
        }
        events.onLocks?.([...locks.values()]);
      };

      const send = (event: string, payload: unknown) => {
        if (!subscribed) {
          queued.push({ event, payload });
          return;
        }
        void room.send({ type: "broadcast", event, payload });
      };

      room.on("broadcast", { event: "live-move" }, ({ payload }) => {
        const move = payload as LiveMove;
        if (!move?.userId || move.userId === self.userId) return;
        events.onMove?.(move);
      });

      room.on("broadcast", { event: "live-lock" }, ({ payload }) => {
        const lock = payload as LiveLock;
        if (!lock?.userId || lock.userId === self.userId) return;
        locks.set(lockKey(lock.surface, lock.objectId), lock);
        emitLocks();
      });

      room.on("broadcast", { event: "live-unlock" }, ({ payload }) => {
        const lock = payload as LiveLock;
        if (!lock?.userId || lock.userId === self.userId) return;
        const key = lockKey(lock.surface, lock.objectId);
        if (locks.get(key)?.userId === lock.userId) locks.delete(key);
        emitLocks();
      });

      room.on("broadcast", { event: "live-commit" }, ({ payload }) => {
        const commit = payload as LiveCommit;
        if (!commit?.userId || commit.userId === self.userId) return;
        events.onCommit?.(commit);
      });

      void room.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        subscribed = true;
        for (const item of queued.splice(0)) {
          void room.send({ type: "broadcast", event: item.event, payload: item.payload });
        }
      });

      // Locks expire on silence; sweep so a crashed peer's claim disappears
      // without any traffic.
      const sweep = setInterval(emitLocks, LIVE_LOCK_TTL_MS / 2);

      return {
        move: (surface, objectId, x, y, rotation) => {
          send("live-move", {
            ...self,
            surface,
            objectId,
            x,
            y,
            ...(rotation !== undefined ? { rotation } : {}),
            at: Date.now(),
          } satisfies LiveMove);
        },
        lock: (surface, objectId) => {
          send("live-lock", { ...self, surface, objectId, at: Date.now() } satisfies LiveLock);
        },
        unlock: (surface, objectId) => {
          send("live-unlock", { ...self, surface, objectId, at: Date.now() } satisfies LiveLock);
        },
        commit: (surface) => {
          send("live-commit", {
            userId: self.userId,
            surface,
            at: Date.now(),
          } satisfies LiveCommit);
        },
        leave: () => {
          clearInterval(sweep);
          void client.removeChannel(room);
        },
      };
    },
  };
}
