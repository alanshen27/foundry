/**
 * Deterministic pastel/solid chip colors for initials avatars.
 * Same userId/name always gets the same color.
 */

const AVATAR_PALETTE = [
  { bg: "bg-rose-500/90", text: "text-white" },
  { bg: "bg-orange-500/90", text: "text-white" },
  { bg: "bg-amber-500/90", text: "text-white" },
  { bg: "bg-lime-600/90", text: "text-white" },
  { bg: "bg-emerald-600/90", text: "text-white" },
  { bg: "bg-teal-600/90", text: "text-white" },
  { bg: "bg-cyan-600/90", text: "text-white" },
  { bg: "bg-sky-600/90", text: "text-white" },
  { bg: "bg-blue-600/90", text: "text-white" },
  { bg: "bg-indigo-500/90", text: "text-white" },
  { bg: "bg-violet-500/90", text: "text-white" },
  { bg: "bg-fuchsia-500/90", text: "text-white" },
] as const;

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function avatarColor(seed: string): { bg: string; text: string } {
  const key = seed.trim() || "?";
  return AVATAR_PALETTE[hashSeed(key) % AVATAR_PALETTE.length]!;
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}
