import "server-only";
import { getServerEnv } from "@foundry/config";

/** Origin the headless renderer loads pages from. */
export function appOrigin(): string {
  const env = getServerEnv();
  return env.APP_ORIGIN ?? "http://localhost:3000";
}
