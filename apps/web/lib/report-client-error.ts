/**
 * Sends a browser error to /api/client-errors. Fire and forget.
 *
 * `keepalive` lets the report finish even when the error is followed by a
 * navigation or the tab closing, which is often exactly what a crash causes.
 * Deduplicated per page load: an effect that re-throws on every render would
 * otherwise send the same report hundreds of times.
 */

const sent = new Set<string>();

export function reportClientError(
  error: unknown,
  boundary: "segment" | "global" | "manual" = "manual",
) {
  if (typeof window === "undefined") return;
  const err = error instanceof Error ? error : new Error(String(error));
  const digest = (err as Error & { digest?: string }).digest;
  const key = `${err.name}:${err.message}:${digest ?? ""}`;
  if (sent.has(key)) return;
  sent.add(key);

  try {
    void fetch("/api/client-errors", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: err.message.slice(0, 2_000) || "(no message)",
        name: err.name.slice(0, 200),
        stack: err.stack?.slice(0, 8_000),
        digest,
        url: window.location.href.slice(0, 2_000),
        boundary,
      }),
    }).catch(() => {
      // Reporting is best effort; a failure to report must not surface.
    });
  } catch {
    // Same.
  }
}
