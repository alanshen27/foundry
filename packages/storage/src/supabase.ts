/**
 * Supabase Storage adapter. Uses the service-role key; server-side only.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { ObjectStoragePort, StoredObject } from "./port";

export type SupabaseStorageConfig = {
  url: string;
  serviceRoleKey: string;
  bucket: string;
};

export function createSupabaseStorageAdapter(config: SupabaseStorageConfig): ObjectStoragePort {
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false },
  });
  const bucket = () => client.storage.from(config.bucket);

  return {
    async put(key, body, contentType): Promise<StoredObject> {
      const { error } = await bucket().upload(key, body, { contentType, upsert: true });
      if (error) throw new Error(`Supabase storage upload failed for ${key}: ${error.message}`);
      return {
        key,
        sha256: createHash("sha256").update(body).digest("hex"),
        sizeBytes: body.byteLength,
        contentType,
        backend: "SUPABASE",
      };
    },

    async getSignedUrl(key, expiresInSeconds = 3600): Promise<string> {
      const { data, error } = await bucket().createSignedUrl(key, expiresInSeconds);
      if (error || !data) {
        throw new Error(`Supabase signed URL failed for ${key}: ${error?.message}`);
      }
      return data.signedUrl;
    },

    async head(key): Promise<StoredObject | null> {
      const { data, error } = await bucket().download(key);
      if (error || !data) return null;
      const body = new Uint8Array(await data.arrayBuffer());
      return {
        key,
        sha256: createHash("sha256").update(body).digest("hex"),
        sizeBytes: body.byteLength,
        contentType: data.type || "application/octet-stream",
        backend: "SUPABASE",
      };
    },

    async delete(key): Promise<void> {
      const { error } = await bucket().remove([key]);
      if (error) throw new Error(`Supabase storage delete failed for ${key}: ${error.message}`);
    },
  };
}
