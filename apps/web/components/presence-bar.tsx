"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createOffRealtimeAdapter,
  createSupabaseRealtimeAdapter,
  type PresenceMember,
} from "@foundry/realtime";

const REALTIME_MODE = process.env.NEXT_PUBLIC_REALTIME_MODE ?? "off";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function PresenceBar({
  channel,
  self,
}: {
  channel: string;
  self: { userId: string; name: string };
}) {
  const [members, setMembers] = useState<PresenceMember[]>([]);

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
      setMembers,
    );
    return () => handle.leave();
  }, [channel, self.userId, realtime]);

  return (
    <div className="flex items-center" aria-label={`${members.length} collaborators online`}>
      {members.slice(0, 5).map((member) => (
        <span
          key={member.userId}
          title={member.name}
          className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-zinc-950 bg-zinc-700 text-xs font-semibold first:ml-0"
        >
          {member.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {members.length > 5 ? (
        <span className="ml-1.5 text-xs text-zinc-500">+{members.length - 5}</span>
      ) : null}
    </div>
  );
}
