/**
 * ObjectStoragePort: the only object-storage surface app code may use.
 * Implementations: Supabase Storage (production) and a local-filesystem
 * adapter labeled SIMULATED (dev/e2e only).
 */
export type StoredObject = {
  key: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  /** "SIMULATED" for the local adapter; "SUPABASE" for real storage. */
  backend: "SUPABASE" | "SIMULATED";
};

export interface ObjectStoragePort {
  put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}
