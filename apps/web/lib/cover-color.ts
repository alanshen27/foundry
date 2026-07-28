/**
 * Deterministic cover colors from a title/name. Used for project-card matrix
 * faces when there is no 3D thumbnail yet.
 */

export type CoverColor = {
  /** Solid fill behind the matrix. */
  bg: string;
  /** Dot / glyph color on top of the fill. */
  dot: string;
};

const COVER_PALETTE: CoverColor[] = [
  { bg: "#ff5a00", dot: "#faf9f5" },
  { bg: "#0c0c0c", dot: "#faf9f5" },
  { bg: "#0d9488", dot: "#faf9f5" },
  { bg: "#e11d48", dot: "#faf9f5" },
  { bg: "#2563eb", dot: "#faf9f5" },
  { bg: "#ca8a04", dot: "#faf9f5" },
  { bg: "#b45309", dot: "#faf9f5" },
  { bg: "#475569", dot: "#faf9f5" },
  { bg: "#0f766e", dot: "#faf9f5" },
  { bg: "#be123c", dot: "#faf9f5" },
];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Stable cover color from a project title (or any seed string). */
export function coverColor(seed: string): CoverColor {
  const key = seed.trim() || "?";
  return COVER_PALETTE[hashSeed(key) % COVER_PALETTE.length]!;
}
