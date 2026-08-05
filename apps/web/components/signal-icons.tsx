import { MatrixScreen } from "@/components/matrix-cover";
import { firstInitial } from "@/lib/avatar-color";
import { cn } from "@/lib/utils";

/**
 * Signal tiles — pure orange plane, white mono letter, optional pixel dissolve.
 * Sharp corners only (Nothing / digital display vibe).
 */

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Folder mark drawn in white on an orange tile: crisp pixel folder — tab,
 * body, two document lines — dissolving into the matrix on its right edge.
 */
export function FolderGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" className={className} aria-hidden>
      {/* Tab */}
      <rect x={5} y={7} width={10} height={3} />
      <rect x={15} y={8} width={2} height={2} opacity={0.7} />
      {/* Body */}
      <rect x={5} y={11} width={21} height={15} />
      {/* Document lines carved out of the body */}
      <rect x={9} y={15} width={13} height={2} className="fill-[var(--glyph-void,#ff5a00)]" />
      <rect x={9} y={19} width={9} height={2} className="fill-[var(--glyph-void,#ff5a00)]" />
      {/* Right-edge dissolve */}
      <rect x={26} y={11} width={2} height={2} opacity={0.75} />
      <rect x={26} y={15} width={2} height={2} opacity={0.45} />
      <rect x={26} y={19} width={2} height={2} opacity={0.75} />
      <rect x={26} y={23} width={2} height={2} opacity={0.35} />
      <rect x={28.5} y={13} width={2} height={2} opacity={0.3} />
      <rect x={28.5} y={17} width={2} height={2} opacity={0.5} />
      <rect x={28.5} y={21} width={2} height={2} opacity={0.22} />
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
  const initial = firstInitial(letter) || "?";
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
