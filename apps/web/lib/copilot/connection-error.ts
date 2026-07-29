/**
 * Browser-level connection failures: laptop sleep, wifi drop, a deploy
 * killing the SSE socket. These say nothing about the run itself — the
 * chat worker keeps executing server-side, so the client must reattach
 * instead of stamping a failure or cancelling the run.
 */
export function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  if (err instanceof TypeError && (message.includes("fetch") || message.includes("network"))) {
    return true; // Chrome: "Failed to fetch" / "network error"
  }
  return (
    message.includes("network error") ||
    message.includes("networkerror") || // Firefox
    message.includes("load failed") || // Safari
    message.includes("connection was lost") || // Safari NSURLError
    message.includes("err_network") ||
    message.includes("err_internet_disconnected")
  );
}
