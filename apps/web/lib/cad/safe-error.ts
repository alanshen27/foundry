export type CadErrorContext = "connection" | "execution" | "import" | "session";

function rawMessage(error: unknown): string {
  try {
    if (error instanceof Error) {
      return typeof error.message === "string" ? error.message : "";
    }
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      return typeof message === "string" ? message : "";
    }
  } catch {
    // Proxies and custom `message` getters can throw. Error presentation must
    // remain safe even when the original failure object is hostile.
  }
  return "";
}

/**
 * Convert engine failures into useful public messages without leaking
 * credentials, environment names, server paths, URLs, headers, stack traces,
 * request internals, or provider implementation details.
 */
export function safeCadError(error: unknown, context: CadErrorContext = "execution"): string {
  const message = rawMessage(error);
  const raw = message.toLowerCase();

  if (
    raw.includes("auth_token_invalid") ||
    raw.includes("unauthorized") ||
    raw.includes("forbidden") ||
    raw.includes("401") ||
    raw.includes("403") ||
    raw.includes("api token") ||
    raw.includes("api_token") ||
    raw.includes("bearer ")
  ) {
    return "The CAD service could not authenticate. Ask a workspace administrator to check the CAD connection.";
  }

  if (
    raw.includes("not configured") ||
    raw.includes("token is empty") ||
    raw.includes("missing token") ||
    raw.includes("environment variable")
  ) {
    return "CAD is not available in this workspace yet. Ask a workspace administrator to configure the CAD service.";
  }

  if (
    raw.includes("timed out") ||
    raw.includes("timeout") ||
    raw.includes("network") ||
    raw.includes("fetch failed") ||
    raw.includes("websocket") ||
    raw.includes("webrtc")
  ) {
    return "The CAD service did not respond. Check your connection and try again.";
  }

  if (context === "import") {
    return "This file could not be imported. Check that it is a supported design file and is not damaged.";
  }
  if (context === "connection" || context === "session") {
    return "The CAD workspace could not start. Try again or contact a workspace administrator.";
  }

  // Source locations help repair KCL but do not reveal the server path.
  const location = /\b(?:line|row)\s+(\d+)(?:[,:]\s*(?:column|col)?\s*(\d+))?/i.exec(message);
  const where = location
    ? ` near line ${location[1]}${location[2] ? `, column ${location[2]}` : ""}`
    : "";
  return `The model could not be rebuilt${where}. Check the latest feature or dimension.`;
}
