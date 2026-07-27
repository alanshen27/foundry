/**
 * Folder colors. A folder stores a palette id; folders that have never been
 * recolored fall back to a hue derived from their id, so a workspace looks
 * organized before anyone picks anything.
 *
 * Class strings are literal because Tailwind only emits names it can read in
 * the source.
 */

export const FOLDER_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "sky",
  "blue",
  "violet",
  "pink",
] as const;

export type FolderColor = (typeof FOLDER_COLORS)[number];

type FolderColorStyle = {
  label: string;
  /** The folder glyph itself. */
  icon: string;
  /** Filled swatch for the picker. */
  swatch: string;
  /** Soft tint behind a folder tile. */
  tile: string;
};

const STYLES: Record<FolderColor, FolderColorStyle> = {
  slate: {
    label: "Slate",
    icon: "text-slate-500 dark:text-slate-400",
    swatch: "bg-slate-500",
    tile: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  },
  red: {
    label: "Red",
    icon: "text-red-500 dark:text-red-400",
    swatch: "bg-red-500",
    tile: "bg-red-500/10 text-red-600 dark:text-red-300",
  },
  orange: {
    label: "Orange",
    icon: "text-orange-500 dark:text-orange-400",
    swatch: "bg-orange-500",
    tile: "bg-orange-500/10 text-orange-600 dark:text-orange-300",
  },
  amber: {
    label: "Amber",
    icon: "text-amber-500 dark:text-amber-400",
    swatch: "bg-amber-500",
    tile: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  },
  green: {
    label: "Green",
    icon: "text-emerald-500 dark:text-emerald-400",
    swatch: "bg-emerald-500",
    tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  },
  teal: {
    label: "Teal",
    icon: "text-teal-500 dark:text-teal-400",
    swatch: "bg-teal-500",
    tile: "bg-teal-500/10 text-teal-600 dark:text-teal-300",
  },
  sky: {
    label: "Sky",
    icon: "text-sky-500 dark:text-sky-400",
    swatch: "bg-sky-500",
    tile: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  },
  blue: {
    label: "Blue",
    icon: "text-blue-500 dark:text-blue-400",
    swatch: "bg-blue-500",
    tile: "bg-blue-500/10 text-blue-600 dark:text-blue-300",
  },
  violet: {
    label: "Violet",
    icon: "text-violet-500 dark:text-violet-400",
    swatch: "bg-violet-500",
    tile: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  },
  pink: {
    label: "Pink",
    icon: "text-pink-500 dark:text-pink-400",
    swatch: "bg-pink-500",
    tile: "bg-pink-500/10 text-pink-600 dark:text-pink-300",
  },
};

export function isFolderColor(value: unknown): value is FolderColor {
  return typeof value === "string" && (FOLDER_COLORS as readonly string[]).includes(value);
}

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Hue for a folder that has never been recolored. Skips slate so the automatic
 * assignment always reads as a deliberate color rather than "uncolored".
 */
export function defaultFolderColor(seed: string): FolderColor {
  const colored = FOLDER_COLORS.filter((c) => c !== "slate");
  return colored[hashSeed(seed || "?") % colored.length]!;
}

export function resolveFolderColor(
  color: string | null | undefined,
  seed: string,
): FolderColor {
  return isFolderColor(color) ? color : defaultFolderColor(seed);
}

export function folderColorStyle(
  color: string | null | undefined,
  seed: string,
): FolderColorStyle {
  return STYLES[resolveFolderColor(color, seed)];
}

export function folderColorLabel(color: FolderColor): string {
  return STYLES[color].label;
}

export function folderSwatchClass(color: FolderColor): string {
  return STYLES[color].swatch;
}
