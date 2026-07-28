import "server-only";
import { getServerEnv } from "@foundry/config";

/** Engine token for the browser Zoo WebRTC viewport (project members only). */
export function getZooEngineToken(): string {
  const token = getServerEnv().ZOO_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "ZOO_API_TOKEN is not configured. Add it to the root .env (see .env.example).",
    );
  }
  return token;
}
