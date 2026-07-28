"use client";

import { useEffect, useMemo, useRef } from "react";
import { GLYPH_CHARS, buildSignalIntensity } from "@/components/signal-glyph";
import { cn } from "@/lib/utils";

/**
 * Living version of SignalGlyph: the ASCII field breathes — a slow wave
 * travels through the mark, characters flicker between densities, edges
 * dissolve and re-form. Canvas-rendered so it stays cheap at large grids.
 * Falls back to a static frame when the user prefers reduced motion.
 */
export function AnimatedSignalGlyph({
  seed,
  rows = 16,
  cols = 24,
  fontSize = 12,
  color = "#faf9f5",
  className,
}: {
  seed: string;
  rows?: number;
  cols?: number;
  /** Glyph cell font size in px (sets intrinsic canvas size). */
  fontSize?: number;
  color?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const field = useMemo(() => buildSignalIntensity(seed, rows, cols), [seed, rows, cols]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cellW = fontSize * 0.72;
    const cellH = fontSize * 1.05;
    const w = Math.ceil(cols * cellW);
    const h = Math.ceil(rows * cellH);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `500 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = "top";

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = true;
    let last = 0;
    const t0 = performance.now();

    function frame(now: number) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      // ~12fps: enough for a dot-matrix flicker, cheap on the main thread.
      if (now - last < 80) return;
      last = now;
      const elapsed = (now - t0) / 1000;

      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = color;
      for (let y = 0; y < rows; y += 1) {
        const rowField = field[y]!;
        for (let x = 0; x < cols; x += 1) {
          const base = rowField[x]!;
          // Slow diagonal wave + per-cell shimmer.
          const wave =
            0.14 * Math.sin(elapsed * 1.4 + (x / cols) * 5.2 + (y / rows) * 3.4) +
            0.08 * Math.sin(elapsed * 2.3 - (x / cols) * 3.1 + (y / rows) * 6.0);
          const t = Math.max(0, Math.min(1, base + wave * Math.min(1, base * 2.4)));
          if (t < 0.08) continue;
          const idx = Math.min(
            GLYPH_CHARS.length - 1,
            1 + Math.floor(t * (GLYPH_CHARS.length - 2)),
          );
          ctx!.globalAlpha = 0.35 + t * 0.65;
          ctx!.fillText(GLYPH_CHARS[idx]!, x * cellW, y * cellH);
        }
      }
      ctx!.globalAlpha = 1;
    }

    if (reduced) {
      // Single static frame.
      frame(t0 + 81);
      running = false;
      cancelAnimationFrame(raf);
      return;
    }

    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [field, rows, cols, fontSize, color]);

  const cssW = Math.ceil(cols * fontSize * 0.72);
  const cssH = Math.ceil(rows * fontSize * 1.05);
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("pointer-events-none h-auto max-w-full select-none", className)}
      style={{ width: cssW, aspectRatio: `${cssW} / ${cssH}` }}
    />
  );
}
