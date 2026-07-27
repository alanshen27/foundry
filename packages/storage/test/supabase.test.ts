import { describe, expect, it } from "vitest";
import { createSupabaseStorageAdapter } from "../src/supabase";

describe("supabase storage adapter", () => {
  it("constructs a port with SUPABASE backend identity on put failures", async () => {
    const storage = createSupabaseStorageAdapter({
      url: "https://example.supabase.co",
      serviceRoleKey: "test-service-role-key",
      bucket: "artifacts",
    });
    await expect(storage.put("x/y.png", new Uint8Array([1, 2, 3]), "image/png")).rejects.toThrow(
      /Supabase storage upload failed/,
    );
  });
});
