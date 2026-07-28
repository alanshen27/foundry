import { describe, expect, it } from "vitest";
import { authCallbackUrl, safeAuthNextPath } from "../server/auth-redirect";

describe("safeAuthNextPath", () => {
  it("allows relative same-origin paths", () => {
    expect(safeAuthNextPath("/w/demo")).toBe("/w/demo");
    expect(safeAuthNextPath("/invite/abc?x=1")).toBe("/invite/abc?x=1");
  });

  it("rejects open redirects", () => {
    expect(safeAuthNextPath("https://evil.example")).toBe("/");
    expect(safeAuthNextPath("//evil.example")).toBe("/");
    expect(safeAuthNextPath("javascript:alert(1)")).toBe("/");
    expect(safeAuthNextPath(null, "/auth/sign-in")).toBe("/auth/sign-in");
  });
});

describe("authCallbackUrl", () => {
  it("strips trailing slash on origin", () => {
    expect(authCallbackUrl("https://app.foundry.test/")).toBe(
      "https://app.foundry.test/auth/callback",
    );
  });
});
