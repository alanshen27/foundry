/**
 * ObjectStoragePort: the only object-storage surface app code may use.
 * Implementation: Supabase Storage.
 */
export type StoredObject = {
  key: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  backend: "SUPABASE";
};

export interface ObjectStoragePort {
  put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject>;
  /** Returns the object bytes and content type, or null if the key does not exist. */
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}
