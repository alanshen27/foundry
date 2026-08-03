"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LIVE_LOCK_TTL_MS,
  LIVE_MOVE_STALE_MS,
  activeLocks,
  createOffLivePort,
  createSupabaseLivePort,
  cursorColor,
  liveEditChannel,
  type LiveEditPort,
  type LiveLock,
  type LiveMove,
} from "@foundry/realtime";

const REALTIME_MODE = process.env.NEXT_PUBLIC_REALTIME_MODE ?? "off";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Live move rebroadcast cap, matching the cursor cadence. */
const MOVE_THROTTLE_MS = 50;

function createLivePort(): LiveEditPort {
  if (REALTIME_MODE === "supabase" && SUPABASE_URL && SUPABASE_ANON_KEY) {
    return createSupabaseLivePort({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  }
  return createOffLivePort();
}

export type UseLiveEdit = {
  /** Peer locks on this surface (own locks excluded, stale expired). */
  locks: LiveLock[];
  /** Latest in-progress peer transform per object on this surface. */
  moves: Map<string, LiveMove>;
  /** The peer holding `objectId`, if any. */
  lockHolder: (objectId: string) => LiveLock | undefined;
  /** Claim an object while editing it; re-heartbeats until released. */
  acquire: (objectId: string) => void;
  /** Release a claim. */
  release: (objectId: string) => void;
  /** Publish an in-progress transform (throttled). */
  reportMove: (objectId: string, x: number, y: number, rotation?: number) => void;
  /** Announce a landed save so peers refetch. */
  commit: () => void;
};

/**
 * Live multiplayer editing for one canvas surface: soft object locks, peer
 * drag mirroring, and save pings. Persisted state stays with the existing
 * save mutations — this is only the in-between made visible.
 */
export function useLiveEdit(
  projectId: string,
  branchId: string,
  surface: string,
  self: { userId: string; name: string },
  onPeerCommit?: () => void,
): UseLiveEdit {
  const [locks, setLocks] = useState<LiveLock[]>([]);
  const [moves, setMoves] = useState<Map<string, LiveMove>>(new Map());
  const port = useMemo(createLivePort, []);
  const color = useMemo(() => cursorColor(self.userId), [self.userId]);

  const handleRef = useRef<ReturnType<LiveEditPort["join"]> | null>(null);
  const heldRef = useRef<Set<string>>(new Set());
  const lastMoveAt = useRef(0);
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const onPeerCommitRef = useRef(onPeerCommit);
  onPeerCommitRef.current = onPeerCommit;

  useEffect(() => {
    if (!projectId || !branchId || !self.userId) return;
    const handle = port.join(
      liveEditChannel(projectId, branchId),
      { userId: self.userId, name: self.name, color },
      {
        onLocks: (all) => setLocks(activeLocks(all, surfaceRef.current, self.userId)),
        onMove: (move) => {
          if (move.surface !== surfaceRef.current) return;
          setMoves((prev) => {
            const next = new Map(prev);
            next.set(move.objectId, move);
            return next;
          });
        },
        onCommit: (commit) => {
          if (commit.surface !== surfaceRef.current) return;
          // The peer's transient moves are now in the persisted doc.
          setMoves(new Map());
          onPeerCommitRef.current?.();
        },
      },
    );
    handleRef.current = handle;

    // Re-announce held locks at half the TTL so one lost packet cannot
    // silently release a claim.
    const heartbeat = setInterval(() => {
      for (const objectId of heldRef.current) {
        handle.lock(surfaceRef.current, objectId);
      }
    }, LIVE_LOCK_TTL_MS / 2);

    // Peer moves are worthless seconds after they were sent.
    const sweep = setInterval(() => {
      setMoves((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [id, move] of next) {
          if (now - move.at > LIVE_MOVE_STALE_MS) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, LIVE_MOVE_STALE_MS);

    return () => {
      clearInterval(heartbeat);
      clearInterval(sweep);
      for (const objectId of heldRef.current) {
        handle.unlock(surfaceRef.current, objectId);
      }
      heldRef.current.clear();
      handle.leave();
      handleRef.current = null;
    };
  }, [port, projectId, branchId, self.userId, self.name, color]);

  const lockHolder = useCallback(
    (objectId: string) => locks.find((l) => l.objectId === objectId),
    [locks],
  );

  const acquire = useCallback((objectId: string) => {
    heldRef.current.add(objectId);
    handleRef.current?.lock(surfaceRef.current, objectId);
  }, []);

  const release = useCallback((objectId: string) => {
    heldRef.current.delete(objectId);
    handleRef.current?.unlock(surfaceRef.current, objectId);
  }, []);

  const reportMove = useCallback((objectId: string, x: number, y: number, rotation?: number) => {
    const now = Date.now();
    if (now - lastMoveAt.current < MOVE_THROTTLE_MS) return;
    lastMoveAt.current = now;
    handleRef.current?.move(surfaceRef.current, objectId, x, y, rotation);
  }, []);

  const commit = useCallback(() => {
    handleRef.current?.commit(surfaceRef.current);
  }, []);

  return { locks, moves, lockHolder, acquire, release, reportMove, commit };
}
