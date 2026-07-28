"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "ink" | "signal";

/**
 * Full-area loading field: a soft radial pulse traveling through a dot matrix.
 * Use for dynamic() fallbacks and large workspace loads.
 */
export function DotMatrixLoader({
  className,
  label = "Loading",
  tone = "ink",
  gap = 12,
  children,
}: {
  className?: string;
  label?: string;
  tone?: Tone;
  gap?: number;
  /** Optional detail under the label (e.g. error message). */
  children?: ReactNode;
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
    let t0 = performance.now();

    function color(): string {
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

    function draw(now: number) {
      if (!running) return;
      raf = requestAnimationFrame(draw);
      const elapsed = (now - t0) / 1000;
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(cx, cy) + 40;
      // Two soft rings sweeping out
      const wave1 = ((elapsed * 0.55) % 1) * maxR;
      const wave2 = ((elapsed * 0.55 + 0.5) % 1) * maxR;
      const base = tone === "signal" ? 0.18 : 0.1;
      const hex = color();

      ctx!.clearRect(0, 0, w, h);
      const cols = Math.ceil(w / gap) + 1;
      const rows = Math.ceil(h / gap) + 1;

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const x = col * gap + gap / 2;
          const y = row * gap + gap / 2;
          const dist = Math.hypot(x - cx, y - cy);
          const ring = (wave: number) => {
            const band = Math.abs(dist - wave);
            return Math.max(0, 1 - band / 28);
          };
          const pulse = Math.max(ring(wave1), ring(wave2) * 0.7);
          const alpha = base + pulse * (tone === "signal" ? 0.9 : 0.75);
          const size = 1.05 + pulse * (tone === "signal" ? 2.1 : 1.6);

          ctx!.beginPath();
          ctx!.fillStyle = hexAlpha(hex, alpha);
          ctx!.arc(x, y, size / 2, 0, Math.PI * 2);
          ctx!.fill();
        }
      }
    }

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    window.addEventListener("resize", resize);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [gap, tone]);

  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden",
        tone === "signal" ? "bg-primary" : "bg-background",
        className,
      )}
      aria-busy="true"
      aria-label={label}
    >
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
      <div className="relative z-10 flex max-w-md flex-col items-center gap-3 px-6 text-center">
        {label ? (
          <p
            className={cn(
              "font-mono text-[11px] tracking-[0.18em] uppercase",
              tone === "signal" ? "text-[#faf9f5]/90" : "text-muted-foreground",
            )}
          >
            {label}
          </p>
        ) : null}
        {children ? (
          <div
            className={cn(
              "font-mono text-xs leading-relaxed",
              tone === "signal" ? "text-[#faf9f5]/85" : "text-destructive",
            )}
          >
            {children}
          </div>
        ) : null}
      </div>
    </div>
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
