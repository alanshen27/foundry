import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const GLYPH_CHARS = [" ", ".", "0", "1", "/", ">", "\\", ":"];

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type Blob = { x: number; y: number; r: number; w: number };

/** Deterministic white-on-orange ASCII density field — Nothing-style digital dissolve. */
export function buildSignalField(
  seed: string,
  rows: number,
  cols: number,
): { char: string; opacity: number }[][] {
  const rand = mulberry32(hashSeed(seed || "foundyr"));
  const blobs: Blob[] = Array.from({ length: 6 + Math.floor(rand() * 3) }, () => ({
    x: 0.15 + rand() * 0.7,
    y: 0.18 + rand() * 0.64,
    r: 0.14 + rand() * 0.28,
    w: 0.7 + rand() * 1.1,
  }));
  // One stronger center pulse so the form reads as a single dissolving mark.
  blobs.push({
    x: 0.42 + rand() * 0.16,
    y: 0.4 + rand() * 0.2,
    r: 0.28 + rand() * 0.12,
    w: 1.35,
  });

  const field: { char: string; opacity: number }[][] = [];
  for (let y = 0; y < rows; y += 1) {
    const row: { char: string; opacity: number }[] = [];
    for (let x = 0; x < cols; x += 1) {
      const nx = (x + 0.5) / cols;
      const ny = (y + 0.5) / rows;
      let d = 0;
      for (const blob of blobs) {
        const dx = (nx - blob.x) / blob.r;
        const dy = (ny - blob.y) / (blob.r * 0.82);
        d += blob.w * Math.exp(-(dx * dx + dy * dy));
      }
      // Soft edge dissolve + grain
      d *= 0.75 + rand() * 0.45;
      const t = Math.max(0, Math.min(1, d * 0.55));
      if (t < 0.08) {
        row.push({ char: " ", opacity: 0 });
      } else {
        const idx = Math.min(
          GLYPH_CHARS.length - 1,
          1 + Math.floor(t * (GLYPH_CHARS.length - 2)),
        );
        row.push({
          char: GLYPH_CHARS[idx]!,
          opacity: 0.35 + t * 0.65,
        });
      }
    }
    field.push(row);
  }
  return field;
}

export function SignalGlyph({
  seed,
  rows = 16,
  cols = 24,
  className,
  monoClassName,
}: {
  seed: string;
  rows?: number;
  cols?: number;
  className?: string;
  monoClassName?: string;
}) {
  const field = buildSignalField(seed, rows, cols);
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none select-none overflow-hidden font-mono leading-[1.05] tracking-[0.08em]",
        className,
      )}
    >
      <pre
        className={cn(
          "m-0 whitespace-pre text-[clamp(7px,1.6vw,11px)] font-medium text-current",
          monoClassName,
        )}
      >
        {field.map((row, yi) => (
          <span key={yi} className="block">
            {row.map((cell, xi) => (
              <span key={xi} style={{ opacity: cell.opacity }}>
                {cell.char === " " ? "\u00A0" : cell.char}
              </span>
            ))}
          </span>
        ))}
      </pre>
    </div>
  );
}

/** Solid signal panel with dissolving ASCII glyph — brand moment. */
export function SignalPanel({
  seed = "foundyr",
  label,
  footer,
  className,
  children,
}: {
  seed?: string;
  label?: string;
  footer?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-primary text-primary-foreground relative flex flex-col overflow-hidden",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.24]"
        style={{
          backgroundImage: "radial-gradient(circle, #faf9f5 0.7px, transparent 0.8px)",
          backgroundSize: "4px 4px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage: "radial-gradient(circle, #faf9f5 1.1px, transparent 1.2px)",
          backgroundSize: "9px 9px",
          backgroundPosition: "2px 2px",
        }}
      />
      {label ? (
        <p className="relative z-10 px-5 pt-5 font-mono text-[11px] tracking-[0.18em] uppercase opacity-90">
          {label}
        </p>
      ) : null}
      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-6 text-[#faf9f5]">
        {children ?? <SignalGlyph seed={seed} rows={20} cols={32} className="opacity-95" />}
      </div>
      {footer ? (
        <p className="relative z-10 px-5 pb-5 font-mono text-[11px] leading-relaxed opacity-80">
          {footer}
        </p>
      ) : null}
    </div>
  );
}
