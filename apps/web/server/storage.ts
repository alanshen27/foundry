import "server-only";
import { getServerEnv } from "@foundry/config";
import {
  createLocalStorageAdapter,
  createSupabaseStorageAdapter,
  type ObjectStoragePort,
} from "@foundry/storage";

let instance: ObjectStoragePort | undefined;

export function getObjectStorage(): ObjectStoragePort {
  if (instance) return instance;
  const env = getServerEnv();
  instance =
    env.STORAGE_MODE === "supabase"
      ? createSupabaseStorageAdapter({
          url: env.NEXT_PUBLIC_SUPABASE_URL!,
          serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
          bucket: env.STORAGE_BUCKET,
        })
      : createLocalStorageAdapter();
  return instance;
}
