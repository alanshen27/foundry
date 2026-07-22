import { describe, expect, it } from "vitest";
import { createSessionToken, hashPassword, verifyPassword, verifySessionToken } from "../src/local";

describe("LOCAL password hashing", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const stored = hashPassword("hunter22");
    expect(verifyPassword("hunter22", stored)).toBe(true);
    expect(verifyPassword("hunter23", stored)).toBe(false);
  });

  it("rejects malformed stored hashes", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("LOCAL session tokens", () => {
  const secret = "test-secret";

  it("round-trips a valid token", () => {
    const token = createSessionToken("user-1", "a@b.c", secret);
    const payload = verifySessionToken(token, secret);
    expect(payload?.userId).toBe("user-1");
    expect(payload?.email).toBe("a@b.c");
  });

  it("rejects tampered tokens and wrong secrets", () => {
    const token = createSessionToken("user-1", "a@b.c", secret);
    expect(verifySessionToken(token + "x", secret)).toBeNull();
    expect(verifySessionToken(token, "other-secret")).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = createSessionToken("user-1", "a@b.c", secret, -1000);
    expect(verifySessionToken(token, secret)).toBeNull();
  });
});
