/**
 * RealtimePort: presence and lightweight broadcast for Phase 0.
 * This is NOT the Yjs document-collaboration layer (Phase 2); it only
 * covers "who is here" presence in the project shell and notifications.
 */
export type PresenceMember = {
  userId: string;
  name: string;
  joinedAt: string;
  /** Optional profile picture URL shown in presence avatars. */
  avatarUrl?: string | null;
};

export type PresenceHandle = {
  leave: () => void;
};

export interface RealtimePort {
  /**
   * Join a presence channel and receive the full member list on every
   * change. Returns a handle used to leave the channel.
   */
  joinPresence(
    channel: string,
    self: PresenceMember,
    onMembers: (members: PresenceMember[]) => void,
  ): PresenceHandle;
}
