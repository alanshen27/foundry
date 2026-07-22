/**
 * Local filesystem adapter (SIMULATED). Development and e2e only —
 * "signed" URLs are plain file paths and provide no access control.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import type { ObjectStoragePort, StoredObject } from "./port";

export function createLocalStorageAdapter(rootDir = ".local-storage"): ObjectStoragePort {
  function resolveKey(key: string): string {
    const path = normalize(join(rootDir, key));
    if (!path.startsWith(normalize(rootDir))) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return path;
  }

  return {
    async put(key, body, contentType): Promise<StoredObject> {
      const path = resolveKey(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      await writeFile(`${path}.meta.json`, JSON.stringify({ contentType }));
      return {
        key,
        sha256: createHash("sha256").update(body).digest("hex"),
        sizeBytes: body.byteLength,
        contentType,
        backend: "SIMULATED",
      };
    },

    async getSignedUrl(key): Promise<string> {
      return `file://${resolveKey(key)}`;
    },

    async head(key): Promise<StoredObject | null> {
      const path = resolveKey(key);
      try {
        const [info, body, metaRaw] = await Promise.all([
          stat(path),
          readFile(path),
          readFile(`${path}.meta.json`, "utf8").catch(() => "{}"),
        ]);
        const meta = JSON.parse(metaRaw) as { contentType?: string };
        return {
          key,
          sha256: createHash("sha256").update(body).digest("hex"),
          sizeBytes: info.size,
          contentType: meta.contentType ?? "application/octet-stream",
          backend: "SIMULATED",
        };
      } catch {
        return null;
      }
    },

    async delete(key): Promise<void> {
      const path = resolveKey(key);
      await rm(path, { force: true });
      await rm(`${path}.meta.json`, { force: true });
    },
  };
}
