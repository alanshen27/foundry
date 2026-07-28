"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Tone = "ink" | "signal";

/**
 * Cursor-reactive dot matrix. Sit behind content — cards/sidebar stay solid
 * and clean; the field only reads in open background.
 */
export function InteractiveDotField({
  className,
  tone = "ink",
  gap = 14,
  radius = 52,
}: {
  className?: string;
  tone?: Tone;
  gap?: number;
  /** Influence radius in CSS pixels. */
  radius?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let running = true;

    const target = { x: -9999, y: -9999, active: false };
    const cursor = { x: -9999, y: -9999, active: 0 };

    function resolveColor(): string {
      if (tone === "signal") return "#faf9f5";
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--foreground")
        .trim();
      return raw.startsWith("#") ? raw : "#0c0c0c";
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = parent!.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      if (!running) return;
      raf = requestAnimationFrame(draw);

      // Ease cursor for a soft industrial pulse feel
      cursor.x += (target.x - cursor.x) * 0.18;
      cursor.y += (target.y - cursor.y) * 0.18;
      cursor.active += ((target.active ? 1 : 0) - cursor.active) * 0.12;

      const color = resolveColor();
      const baseAlpha = tone === "signal" ? 0.2 : 0.14;
      ctx!.clearRect(0, 0, w, h);

      const cols = Math.ceil(w / gap) + 1;
      const rows = Math.ceil(h / gap) + 1;
      const mx = cursor.x;
      const my = cursor.y;
      const influence = cursor.active;
      const r2 = radius * radius;

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          let x = col * gap + gap / 2;
          let y = row * gap + gap / 2;
          let size = 1.1;
          let alpha = baseAlpha;

          if (influence > 0.01) {
            const dx = x - mx;
            const dy = y - my;
            const dist2 = dx * dx + dy * dy;
            if (dist2 < r2) {
              const dist = Math.sqrt(dist2);
              const t = (1 - dist / radius) * influence;
              const push = t * t * 5;
              const nx = dist > 0.001 ? dx / dist : 0;
              const ny = dist > 0.001 ? dy / dist : 0;
              x += nx * push;
              y += ny * push;
              size = 1.1 + t * 1.4;
              alpha = baseAlpha + t * 0.45;
            }
          }

          ctx!.beginPath();
          ctx!.fillStyle = hexAlpha(color, alpha);
          ctx!.arc(x, y, size / 2, 0, Math.PI * 2);
          ctx!.fill();
        }
      }
    }

    function onMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      target.x = e.clientX - rect.left;
      target.y = e.clientY - rect.top;
      // Only "active" when cursor is over the field's box
      target.active =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
    }
    function onLeave() {
      target.active = false;
    }

    resize();
    draw();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    window.addEventListener("resize", resize);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("resize", resize);
    };
  }, [gap, radius, tone]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
    />
  );
}

function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
