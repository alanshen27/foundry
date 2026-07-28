/**
 * Live cursors: where each collaborator is pointing, on which surface.
 *
 * Deliberately built on broadcast rather than presence. A cursor position is
 * worthless a second after it is sent, so there is nothing to reconcile and
 * nothing worth persisting — presence state sync would pay for durability this
 * data does not want. Peers are instead expired client-side after a short
 * silence, which also handles a browser that closes without saying goodbye.
 *
 * This is presence, not collaborative editing. It shows where people are; it
 * does not stop two people changing the same thing (see RealtimePort's note
 * about Yjs being the document-collaboration layer).
 */

export type CursorState = {
  userId: string;
  name: string;
  /** Assigned from the id so everyone sees the same person in the same colour. */
  color: string;
  /** Position in the surface's own coordinate space. */
  x: number;
  y: number;
  /** Which canvas the cursor is on; a peer on another surface is not drawn. */
  surface: string;
  /** Sender's clock, used only to drop stale peers. */
  at: number;
};

export type CursorHandle = {
  /** Publish a new position. Callers should throttle; see CURSOR_THROTTLE_MS. */
  move: (x: number, y: number) => void;
  /** Announce departure so peers can drop the cursor without waiting to expire. */
  leave: () => void;
};

export interface CursorPort {
  join(
    channel: string,
    self: Pick<CursorState, "userId" | "name" | "color" | "surface">,
    onPeers: (peers: CursorState[]) => void,
  ): CursorHandle;
}

/**
 * Cursor updates are capped at 20 Hz. This is the number that actually decides
 * what live cursors cost: a pointer fires far faster than any human can
 * perceive, and every provider meters messages, so the sane rate matters more
 * than the choice of provider.
 */
export const CURSOR_THROTTLE_MS = 50;

/** A peer silent for this long is treated as gone. */
export const CURSOR_STALE_MS = 5_000;

/** Channels are per project branch; the surface travels inside the payload. */
export function cursorChannel(projectId: string, branchId: string): string {
  return `foundry:cursors:${projectId}:${branchId}`;
}

/**
 * Colours picked to stay distinguishable on both light and dark canvases, and
 * to avoid the greens already used for wires and the reds/blues used for
 * copper layers.
 */
export const CURSOR_COLORS = [
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#a855f7",
  "#14b8a6",
];

/**
 * Stable colour per user. Derived from the id rather than assigned on join so
 * every client agrees without coordinating, and so a reconnect does not change
 * someone's colour mid-session.
 */
export function cursorColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length]!;
}

/** Drops peers that have gone quiet, and anyone on a different surface. */
export function activeCursors(
  peers: Iterable<CursorState>,
  surface: string,
  now = Date.now(),
): CursorState[] {
  const out: CursorState[] = [];
  for (const peer of peers) {
    if (peer.surface !== surface) continue;
    if (now - peer.at > CURSOR_STALE_MS) continue;
    out.push(peer);
  }
  return out;
}
