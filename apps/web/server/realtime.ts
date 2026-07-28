import "server-only";

import { getServerEnv } from "@foundry/config";
import {
  createOffBroadcastPublisher,
  createSupabaseBroadcastPublisher,
  type BroadcastPublisher,
} from "@foundry/realtime";

let publisher: BroadcastPublisher | undefined;

/** Shared best-effort publisher for copilot and site-generation rooms. */
export function getBroadcastPublisher(): BroadcastPublisher {
  if (publisher) return publisher;
  const env = getServerEnv();
  if (
    env.NEXT_PUBLIC_REALTIME_MODE === "supabase" &&
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    publisher = createSupabaseBroadcastPublisher({
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
  } else {
    publisher = createOffBroadcastPublisher();
  }
  return publisher;
}
