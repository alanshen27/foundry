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

/** Per-frame blend toward the latest peer target (higher = snappier). */
const CURSOR_LERP = 0.42;
/** Stop lerping when within this many coordinate units of the target. */
const CURSOR_SNAP_EPS = 0.002;

function createCursorPort(): CursorPort {
  if (REALTIME_MODE === "supabase" && SUPABASE_URL && SUPABASE_ANON_KEY) {
    return createSupabaseCursorPort({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  }
  return createOffCursorPort();
}

function peersEqual(a: CursorState[], b: CursorState[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.userId !== y.userId ||
      x.x !== y.x ||
      x.y !== y.y ||
      x.name !== y.name ||
      x.color !== y.color ||
      x.surface !== y.surface
    ) {
      return false;
    }
  }
  return true;
}

export type UseCursors = {
  /** Peers currently pointing at this surface (display-smoothed). */
  peers: CursorState[];
  /** Report the local pointer, already in the surface's coordinate space. */
  report: (x: number, y: number) => void;
  /** Own colour, so the local user can be shown the same hue peers see. */
  color: string;
};

/**
 * Live cursors for one canvas.
 *
 * `report` is throttled to CURSOR_THROTTLE_MS. Received peers are lerped on
 * rAF so motion stays smooth without re-rendering heavy parents every packet
 * when the overlay owns this hook.
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

  const targetsRef = useRef<Map<string, CursorState>>(new Map());
  const displayRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const rafRef = useRef<number | null>(null);
  const surfacePeersRef = useRef<CursorState[]>([]);

  const publishDisplay = useCallback(() => {
    const next: CursorState[] = [];
    for (const target of targetsRef.current.values()) {
      const disp = displayRef.current.get(target.userId) ?? { x: target.x, y: target.y };
      next.push({ ...target, x: disp.x, y: disp.y });
    }
    next.sort((a, b) => a.userId.localeCompare(b.userId));
    setPeers((prev) => (peersEqual(prev, next) ? prev : next));
  }, []);

  const tick = useCallback(() => {
    rafRef.current = null;
    let moving = false;
    for (const [id, target] of targetsRef.current) {
      const cur = displayRef.current.get(id) ?? { x: target.x, y: target.y };
      const dx = target.x - cur.x;
      const dy = target.y - cur.y;
      if (Math.abs(dx) < CURSOR_SNAP_EPS && Math.abs(dy) < CURSOR_SNAP_EPS) {
        displayRef.current.set(id, { x: target.x, y: target.y });
      } else {
        displayRef.current.set(id, {
          x: cur.x + dx * CURSOR_LERP,
          y: cur.y + dy * CURSOR_LERP,
        });
        moving = true;
      }
    }
    for (const id of [...displayRef.current.keys()]) {
      if (!targetsRef.current.has(id)) displayRef.current.delete(id);
    }
    publishDisplay();
    if (moving) rafRef.current = requestAnimationFrame(tick);
  }, [publishDisplay]);

  const ensureRaf = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => {
    // CAD/PCB/schematic pass "anonymous" until the session query resolves.
    // Joining under that shared id collapses every loading client into one peer.
    if (!projectId || !branchId || self.userId === "anonymous") {
      targetsRef.current.clear();
      displayRef.current.clear();
      surfacePeersRef.current = [];
      setPeers([]);
      return;
    }

    const channel = cursorChannel(projectId, branchId);
    const handle = port.join(
      channel,
      { userId: self.userId, name: self.name, color, surface },
      (incoming) => {
        const active = activeCursors(incoming, surface);
        if (peersEqual(surfacePeersRef.current, active)) return;
        surfacePeersRef.current = active;

        const nextTargets = new Map<string, CursorState>();
        for (const peer of active) {
          nextTargets.set(peer.userId, peer);
          if (!displayRef.current.has(peer.userId)) {
            displayRef.current.set(peer.userId, { x: peer.x, y: peer.y });
          }
        }
        targetsRef.current = nextTargets;
        ensureRaf();
      },
    );
    handleRef.current = handle;

    const onUnload = () => handle.leave();
    window.addEventListener("beforeunload", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onUnload);
      handle.leave();
      handleRef.current = null;
      if (timer.current) clearTimeout(timer.current);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      targetsRef.current.clear();
      displayRef.current.clear();
    };
  }, [projectId, branchId, surface, self.userId, self.name, color, port, ensureRaf]);

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
      // Drop micro-jitter only. 0.5 was wrong for CAD's normalized 0…1 space
      // (half a viewport) and made peer cursors look stuck / extremely laggy.
      if (last && Math.hypot(last.x - x, last.y - y) < 0.001) return;

      const since = Date.now() - lastSentAt.current;
      if (since >= CURSOR_THROTTLE_MS) {
        lastSentAt.current = Date.now();
        lastPos.current = { x, y };
        handleRef.current?.move(x, y);
        return;
      }
      pending.current = { x, y };
      if (!timer.current) timer.current = setTimeout(flush, CURSOR_THROTTLE_MS - since);
    },
    [flush],
  );

  return { peers, report, color };
}
