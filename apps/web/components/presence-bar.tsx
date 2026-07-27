"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createOffRealtimeAdapter,
  createSupabaseRealtimeAdapter,
  dedupePresenceMembers,
  type PresenceMember,
} from "@foundry/realtime";
import { UserAvatar } from "@/components/user-avatar";

const REALTIME_MODE = process.env.NEXT_PUBLIC_REALTIME_MODE ?? "off";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Member = PresenceMember & { avatarUrl?: string | null };

export function PresenceBar({
  channel,
  self,
}: {
  channel: string;
  self: { userId: string; name: string; avatarUrl?: string | null };
}) {
  const [members, setMembers] = useState<Member[]>([]);

  const realtime = useMemo(() => {
    if (REALTIME_MODE === "supabase" && SUPABASE_URL && SUPABASE_ANON_KEY) {
      return createSupabaseRealtimeAdapter({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
    }
    return createOffRealtimeAdapter();
  }, []);

  useEffect(() => {
    const handle = realtime.joinPresence(
      channel,
      { ...self, joinedAt: new Date().toISOString() },
      (m) => setMembers(dedupePresenceMembers(m) as Member[]),
    );
    return () => handle.leave();
  }, [channel, self.userId, realtime]);

  const list = useMemo(() => {
    const deduped = dedupePresenceMembers(members);
    if (deduped.length > 0) return deduped;
    return [
      {
        userId: self.userId,
        name: self.name,
        avatarUrl: self.avatarUrl,
        joinedAt: new Date(0).toISOString(),
      },
    ] satisfies Member[];
  }, [members, self.userId, self.name, self.avatarUrl]);

  return (
    <div className="flex items-center" aria-label={`${list.length} collaborators online`}>
      {list.slice(0, 5).map((member) => (
        <UserAvatar
          key={member.userId}
          userId={member.userId}
          name={member.name}
          avatarUrl={member.avatarUrl}
          className="border-background -ml-2 size-7 border-2 first:ml-0"
        />
      ))}
      {list.length > 5 ? (
        <span className="text-muted-foreground ml-1.5 text-xs">+{list.length - 5}</span>
      ) : null}
    </div>
  );
}
