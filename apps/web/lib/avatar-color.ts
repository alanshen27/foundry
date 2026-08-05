/**
 * Deterministic pastel/solid chip colors for initials avatars.
 * Same userId/name always gets the same color.
 *
 * `bg`/`text` are the saturated chip pair, sized for small avatars. `tile` is a
 * washed-out version for large surfaces like card previews, where the solid
 * fill reads as a colour block rather than an accent.
 */

const AVATAR_PALETTE = [
  {
    bg: "bg-rose-500/90",
    text: "text-white",
    tile: "bg-rose-500/12 text-rose-600 dark:text-rose-300",
  },
  {
    bg: "bg-orange-500/90",
    text: "text-white",
    tile: "bg-orange-500/12 text-orange-600 dark:text-orange-300",
  },
  {
    bg: "bg-amber-500/90",
    text: "text-white",
    tile: "bg-amber-500/12 text-amber-600 dark:text-amber-300",
  },
  {
    bg: "bg-lime-600/90",
    text: "text-white",
    tile: "bg-lime-600/12 text-lime-700 dark:text-lime-300",
  },
  {
    bg: "bg-emerald-600/90",
    text: "text-white",
    tile: "bg-emerald-600/12 text-emerald-700 dark:text-emerald-300",
  },
  {
    bg: "bg-teal-600/90",
    text: "text-white",
    tile: "bg-teal-600/12 text-teal-700 dark:text-teal-300",
  },
  {
    bg: "bg-cyan-600/90",
    text: "text-white",
    tile: "bg-cyan-600/12 text-cyan-700 dark:text-cyan-300",
  },
  { bg: "bg-sky-600/90", text: "text-white", tile: "bg-sky-600/12 text-sky-700 dark:text-sky-300" },
  {
    bg: "bg-blue-600/90",
    text: "text-white",
    tile: "bg-blue-600/12 text-blue-700 dark:text-blue-300",
  },
  {
    bg: "bg-indigo-500/90",
    text: "text-white",
    tile: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-300",
  },
  {
    bg: "bg-violet-500/90",
    text: "text-white",
    tile: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  },
  {
    bg: "bg-fuchsia-500/90",
    text: "text-white",
    tile: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-300",
  },
] as const;

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function avatarColor(seed: string): { bg: string; text: string; tile: string } {
  const key = seed.trim() || "?";
  return AVATAR_PALETTE[hashSeed(key) % AVATAR_PALETTE.length]!;
}

/**
 * Leading character of a name, uppercased, taken by code point. Slicing by
 * UTF-16 unit would cut an astral character — an emoji or a mathematical
 * letter — in half and render the lone surrogate as a replacement glyph.
 *
 * Shared with the workspace/folder tiles, which letter themselves the same way.
 */
export function firstInitial(word: string): string {
  return (Array.from(word.trim())[0] ?? "").toUpperCase();
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return firstInitial(parts[0]!);
  return `${firstInitial(parts[0]!)}${firstInitial(parts[1]!)}`;
}
