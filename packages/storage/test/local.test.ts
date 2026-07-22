import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalStorageAdapter } from "../src/local";

describe("local storage adapter (SIMULATED)", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "foundry-storage-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips put/head/delete and labels backend SIMULATED", async () => {
    const storage = createLocalStorageAdapter(root);
    const body = new TextEncoder().encode("hello foundry");

    const stored = await storage.put("w1/p1/readme.txt", body, "text/plain");
    expect(stored.backend).toBe("SIMULATED");
    expect(stored.sizeBytes).toBe(body.byteLength);

    const head = await storage.head("w1/p1/readme.txt");
    expect(head?.sha256).toBe(stored.sha256);
    expect(head?.contentType).toBe("text/plain");

    await storage.delete("w1/p1/readme.txt");
    expect(await storage.head("w1/p1/readme.txt")).toBeNull();
  });

  it("rejects path-traversal keys", async () => {
    const storage = createLocalStorageAdapter(root);
    await expect(storage.put("../escape", new Uint8Array(1), "x")).rejects.toThrow(
      /Invalid storage key/,
    );
  });
});
