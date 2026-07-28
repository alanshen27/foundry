import { describe, expect, it } from "vitest";
import type { SignUpOptions } from "../src/port";

describe("SignUpOptions emailRedirectTo", () => {
  it("accepts an absolute callback URL shape used by the web app", () => {
    const options: SignUpOptions = {
      emailRedirectTo: "https://app.foundry.test/auth/callback",
    };
    expect(options.emailRedirectTo?.endsWith("/auth/callback")).toBe(true);
  });
});
