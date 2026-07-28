"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CURSOR_THROTTLE_MS,
  activeCursors,
  createOffCursorPort,
  createSupabaseCursorPort,
  cursorChannel,
  cursorColor,
  type CursorPort,
  type CursorState,
} from "@foundry/realtime";

const REALTIME_MODE = process.env.NEXT_PUBLIC_REALTIME_MODE ?? "off";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function createCursorPort(): CursorPort {
  if (REALTIME_MODE === "supabase" && SUPABASE_URL && SUPABASE_ANON_KEY) {
    return createSupabaseCursorPort({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  }
  return createOffCursorPort();
}

export type UseCursors = {
  /** Peers currently pointing at this surface. */
  peers: CursorState[];
  /** Report the local pointer, already in the surface's coordinate space. */
  report: (x: number, y: number) => void;
  /** Own colour, so the local user can be shown the same hue peers see. */
  color: string;
};

/**
 * Live cursors for one canvas.
 *
 * `report` is throttled to CURSOR_THROTTLE_MS and drops repeats of the same
 * position. A pointer fires far faster than anyone can perceive, and every
 * realtime provider meters messages, so this throttle — not the choice of
 * provider — is what decides what the feature costs to run.
 */
export function useCursors(
  projectId: string,
  branchId: string,
  surface: string,
  self: { userId: string; name: string },
): UseCursors {
  const [peers, setPeers] = useState<CursorState[]>([]);
  const port = useMemo(createCursorPort, []);
  const color = useMemo(() => cursorColor(self.userId), [self.userId]);

  const handleRef = useRef<ReturnType<CursorPort["join"]> | null>(null);
  const lastSentAt = useRef(0);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // CAD/PCB/schematic pass "anonymous" until the session query resolves.
    // Joining under that shared id collapses every loading client into one peer.
    if (!projectId || !branchId || self.userId === "anonymous") {
      setPeers([]);
      return;
    }

    const channel = cursorChannel(projectId, branchId);
    const handle = port.join(
      channel,
      { userId: self.userId, name: self.name, color, surface },
      // Peers arrive for every surface on this branch; filter to ours and drop
      // anyone who has gone quiet.
      (incoming) => setPeers(activeCursors(incoming, surface)),
    );
    handleRef.current = handle;

    // Leaving on unload matters more than on unmount: closing a tab is the
    // common case, and without it peers wait out the staleness window.
    const onUnload = () => handle.leave();
    window.addEventListener("beforeunload", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onUnload);
      handle.leave();
      handleRef.current = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [projectId, branchId, surface, self.userId, self.name, color, port]);

  const flush = useCallback(() => {
    const next = pending.current;
    pending.current = null;
    timer.current = null;
    if (!next) return;
    lastSentAt.current = Date.now();
    lastPos.current = next;
    handleRef.current?.move(next.x, next.y);
  }, []);

  const report = useCallback(
    (x: number, y: number) => {
      const last = lastPos.current;
      // Sub-pixel jitter is invisible; not sending it halves the traffic when
      // a hand rests on the mouse.
      if (last && Math.abs(last.x - x) < 0.5 && Math.abs(last.y - y) < 0.5) return;

      const since = Date.now() - lastSentAt.current;
      if (since >= CURSOR_THROTTLE_MS) {
        lastSentAt.current = Date.now();
        lastPos.current = { x, y };
        handleRef.current?.move(x, y);
        return;
      }
      // Inside the window: keep only the newest position and send it on time,
      // so a fast drag still ends where the pointer actually stopped.
      pending.current = { x, y };
      if (!timer.current) timer.current = setTimeout(flush, CURSOR_THROTTLE_MS - since);
    },
    [flush],
  );

  return { peers, report, color };
}
