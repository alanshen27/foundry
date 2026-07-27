import type { PresenceMember } from "./port";

/**
 * Collapse presence metas to one entry per user. Supabase can return
 * multiple metas for the same presence key after reconnects or Strict Mode
 * remounts; without this the avatar stack shows duplicates.
 */
export function dedupePresenceMembers(members: PresenceMember[]): PresenceMember[] {
  const byUser = new Map<string, PresenceMember>();
  for (const member of members) {
    const existing = byUser.get(member.userId);
    if (!existing || member.joinedAt >= existing.joinedAt) {
      byUser.set(member.userId, member);
    }
  }
  return Array.from(byUser.values()).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}
