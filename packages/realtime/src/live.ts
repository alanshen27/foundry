/**
 * Live editing: transient object transforms, soft locks, and commit pings for
 * the visual canvases (PCB footprints, CAD parts). One protocol serves every
 * surface — the surface travels inside the payload, like live cursors.
 *
 * Built on broadcast, not a CRDT, on purpose. The persisted document stays
 * owned by the existing save mutations; this layer only makes the *in-between*
 * visible: where a peer is dragging something right now, which object a peer
 * has claimed, and when a save landed so others should refetch. A lock here is
 * a soft lock — it renders the object untouchable in peer UIs and expires on
 * silence, so a crashed tab can never wedge the document.
 */

export type LiveActor = {
  userId: string;
  name: string;
  /** Same id-derived colour used for the user's cursor. */
  color: string;
};

/** A peer's in-progress transform of one object, in surface coordinates. */
export type LiveMove = LiveActor & {
  surface: string;
  objectId: string;
  x: number;
  y: number;
  rotation?: number;
  /** Sender's clock, used only to drop stale entries. */
  at: number;
};

/** A peer's claim on one object while they are editing it. */
export type LiveLock = LiveActor & {
  surface: string;
  objectId: string;
  at: number;
};

/** A peer saved the document for this surface; others should refetch. */
export type LiveCommit = {
  userId: string;
  surface: string;
  at: number;
};

export type LiveEditHandle = {
  /** Publish an in-progress transform. Callers should throttle like cursors. */
  move: (surface: string, objectId: string, x: number, y: number, rotation?: number) => void;
  /** Claim an object. Re-send within LIVE_LOCK_TTL_MS to keep the claim. */
  lock: (surface: string, objectId: string) => void;
  /** Release a claim (also clears any transient move for the object). */
  unlock: (surface: string, objectId: string) => void;
  /** Announce that a save landed so peers refetch the persisted document. */
  commit: (surface: string) => void;
  leave: () => void;
};

export type LiveEditEvents = {
  onMove?: (move: LiveMove) => void;
  onLocks?: (locks: LiveLock[]) => void;
  onCommit?: (commit: LiveCommit) => void;
};

export interface LiveEditPort {
  join(channel: string, self: LiveActor, events: LiveEditEvents): LiveEditHandle;
}

/**
 * A lock not re-announced within this window is dropped. Holders re-send at
 * half this cadence, so one missed packet does not release someone's claim.
 */
export const LIVE_LOCK_TTL_MS = 6_000;

/** A transient move older than this is discarded rather than rendered. */
export const LIVE_MOVE_STALE_MS = 3_000;

/** Channels are per project branch, matching cursorChannel. */
export function liveEditChannel(projectId: string, branchId: string): string {
  return `foundry:live:${projectId}:${branchId}`;
}

/** Drops expired locks, and any lock held by `selfUserId` (local echo). */
export function activeLocks(
  locks: Iterable<LiveLock>,
  surface: string,
  selfUserId: string,
  now = Date.now(),
): LiveLock[] {
  const out: LiveLock[] = [];
  for (const lock of locks) {
    if (lock.surface !== surface) continue;
    if (lock.userId === selfUserId) continue;
    if (now - lock.at > LIVE_LOCK_TTL_MS) continue;
    out.push(lock);
  }
  return out;
}
