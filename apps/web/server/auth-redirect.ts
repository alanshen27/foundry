/**
 * Only allow same-origin relative paths for post-auth redirects.
 * Rejects protocol-relative (`//evil`) and absolute URLs.
 */
export function safeAuthNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  const trimmed = next.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("://")) return fallback;
  return trimmed;
}

/** Absolute callback URL used as Supabase `emailRedirectTo`. */
export function authCallbackUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/auth/callback`;
}
