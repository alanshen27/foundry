import "server-only";
import { getServerEnv } from "@foundry/config";
import { createSupabaseStorageAdapter, type ObjectStoragePort } from "@foundry/storage";

let instance: ObjectStoragePort | undefined;

/** Supabase Storage — the only object-storage backend. */
export function getObjectStorage(): ObjectStoragePort {
  if (instance) return instance;
  const env = getServerEnv();
  instance = createSupabaseStorageAdapter({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: env.STORAGE_BUCKET,
  });
  return instance;
}
