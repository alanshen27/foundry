/** Models invent nil/repeating UUIDs; those must never hit the Zoo resume path. */
export function isPlausibleZooOpId(id: string | undefined | null): boolean {
  if (!id || typeof id !== "string") return false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(id.trim())) return false;
  const hex = id.replace(/-/g, "").toLowerCase();
  // Placeholders like 4444…8444… still validate as UUID v4 — reject low entropy.
  const counts = new Map<string, number>();
  for (const ch of hex) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const max = Math.max(...counts.values());
  if (max >= 24) return false;
  if (hex === "0123456789abcdef0123456789abcdef") return false;
  return true;
}
