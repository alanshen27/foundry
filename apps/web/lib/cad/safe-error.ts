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
 * Failure buckets, most specific first. Each maps raw engine text to a public
 * message that names the next action without echoing anything from the error.
 */
const BUCKETS: { keywords: string[]; message: string }[] = [
  {
    keywords: [
      "auth_token_invalid",
      "unauthorized",
      "forbidden",
      "401",
      "403",
      "api token",
      "api_token",
      "bearer ",
    ],
    message:
      "The CAD service could not authenticate. Ask a workspace administrator to check the CAD connection.",
  },
  {
    keywords: ["not configured", "token is empty", "missing token", "environment variable"],
    message:
      "CAD is not available in this workspace yet. Ask a workspace administrator to configure the CAD service.",
  },
  {
    keywords: ["timed out", "timeout", "network", "fetch failed", "websocket", "webrtc"],
    message: "The CAD service did not respond. Check your connection and try again.",
  },
];

/**
 * Convert engine failures into useful public messages without leaking
 * credentials, environment names, server paths, URLs, headers, stack traces,
 * request internals, or provider implementation details.
 */
export function safeCadError(error: unknown, context: CadErrorContext = "execution"): string {
  const message = rawMessage(error);
  const raw = message.toLowerCase();

  const bucket = BUCKETS.find((b) => b.keywords.some((k) => raw.includes(k)));
  if (bucket) return bucket.message;

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
