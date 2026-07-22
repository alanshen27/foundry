/**
 * No-op adapter used when NEXT_PUBLIC_REALTIME_MODE=off. You only see
 * yourself in the presence bar; nothing is simulated or faked.
 */
import type { PresenceHandle, PresenceMember, RealtimePort } from "./port";

export function createOffRealtimeAdapter(): RealtimePort {
  return {
    joinPresence(
      _channel: string,
      self: PresenceMember,
      onMembers: (members: PresenceMember[]) => void,
    ): PresenceHandle {
      onMembers([self]);
      return { leave: () => {} };
    },
  };
}
