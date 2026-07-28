import { coverColor } from "@/lib/cover-color";
import { cn } from "@/lib/utils";

/**
 * Plain industrial cover: solid fill + CSS dot matrix, color hashed from title.
 * Used on project cards when no 3D thumbnail is available.
 *
 * Dots are ≥1px so they survive HiDPI antialiasing (0.55px screens wash out).
 */
export function MatrixScreen({
  color,
  className,
  opacity = 0.38,
}: {
  color: string;
  className?: string;
  opacity?: number;
}) {
  return (
    <>
      <span
        className={cn("pointer-events-none absolute inset-0", className)}
        style={{
          opacity,
          backgroundImage: `radial-gradient(circle, ${color} 1px, transparent 1.15px)`,
          backgroundSize: "5px 5px",
        }}
        aria-hidden
      />
      <span
        className={cn("pointer-events-none absolute inset-0", className)}
        style={{
          opacity: opacity * 0.55,
          backgroundImage: `radial-gradient(circle, ${color} 1.35px, transparent 1.55px)`,
          backgroundSize: "12px 12px",
          backgroundPosition: "3px 3px",
        }}
        aria-hidden
      />
    </>
  );
}

export function MatrixCover({
  seed,
  className,
  label,
}: {
  /** Usually the project name — same title → same color. */
  seed: string;
  className?: string;
  /** Optional mono caption in the corner. */
  label?: string;
}) {
  const { bg, dot } = coverColor(seed);
  return (
    <div
      className={cn("relative size-full overflow-hidden", className)}
      style={{ backgroundColor: bg }}
      aria-hidden
    >
      <MatrixScreen color={dot} />
      {label ? (
        <span
          className="absolute top-2 left-2 font-mono text-[10px] tracking-[0.14em] uppercase"
          style={{ color: dot, opacity: 0.75 }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
