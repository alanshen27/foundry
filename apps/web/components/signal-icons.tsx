import { MatrixScreen } from "@/components/matrix-cover";
import { cn } from "@/lib/utils";

/**
 * Signal tiles — pure orange plane, white mono letter, optional pixel dissolve.
 * Sharp corners only (Nothing / digital display vibe).
 */

const U = 3;

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Folder mark drawn in white on an orange tile. */
export function FolderGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" className={className} aria-hidden>
      <rect x={1} y={15} width={U} height={U} opacity={0.22} />
      <rect x={4} y={12} width={U} height={U} opacity={0.45} />
      <rect x={4} y={16} width={U} height={U} opacity={0.8} />
      <rect x={4} y={20} width={U} height={U} opacity={0.35} />
      <rect x={7} y={10} width={U} height={U} opacity={0.6} />
      <rect x={7} y={14} width={U} height={U} />
      <rect x={7} y={18} width={U} height={U} />
      <rect x={7} y={22} width={U} height={U} opacity={0.55} />

      <rect x={10} y={9} width={9} height={4} />
      <rect x={19} y={9} width={U} height={4} opacity={0.4} />
      <rect x={10} y={13} width={17} height={14} />
      <rect x={14} y={17} width={8} height={5} className="fill-[var(--glyph-void,#ff5a00)]" />
    </svg>
  );
}

/**
 * Workspace id tile: solid orange square, white flashing initial,
 * fine white dot screen — no rounded chrome.
 */
export function SignalIconTile({
  kind = "workspace",
  seed = "ws",
  letter = "W",
  className,
}: {
  kind?: "workspace" | "folder";
  seed?: string;
  letter?: string;
  className?: string;
}) {
  const initial = (letter.trim().slice(0, 1) || "?").toUpperCase();
  const delayMs = (hashSeed(seed) % 900) + 200;

  if (kind === "folder") {
    return (
      <span
        className={cn(
          "bg-primary text-[#faf9f5] relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-none",
          className,
        )}
        style={{ ["--glyph-void" as string]: "#ff5a00" }}
      >
        <MatrixScreen color="#faf9f5" opacity={0.4} />
        <FolderGlyph className="relative z-[1] size-[70%]" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "@container bg-primary relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-none",
        className,
      )}
      aria-hidden
    >
      <MatrixScreen color="#faf9f5" opacity={0.42} />
      <span
        className="signal-letter relative z-[1] font-mono leading-none font-semibold tracking-[-0.08em] text-[#faf9f5]"
        style={{
          fontSize: "58cqi",
          animationDelay: `${delayMs}ms`,
        }}
      >
        {initial}
      </span>
    </span>
  );
}
