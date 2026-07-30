import { describe, expect, it } from "vitest";
import { safeCadError } from "@/lib/cad/safe-error";

describe("safeCadError", () => {
  it("does not expose environment names, paths, URLs, or credentials", () => {
    const message = safeCadError(
      new Error(
        "ZOO_API_TOKEN sk-secret at /Users/admin/project/.env failed https://api.example.test",
      ),
      "connection",
    );
    expect(message).toContain("workspace administrator");
    expect(message).not.toMatch(/ZOO_API_TOKEN|sk-secret|\/Users|https?:|\.env/i);
  });

  it("keeps only a useful source location for modeling errors", () => {
    const message = safeCadError(
      new Error("Parse failure at /srv/foundry/main.kcl line 18, column 4; DATABASE_URL=secret"),
    );
    expect(message).toContain("line 18, column 4");
    expect(message).not.toMatch(/\/srv|DATABASE_URL|secret/i);
  });

  it("never stringifies arbitrary error objects", () => {
    const message = safeCadError({ token: "secret", stack: "/private/app.ts:12" }, "import");
    expect(message).toBe(
      "This file could not be imported. Check that it is a supported design file and is not damaged.",
    );
  });

  it("does not let a hostile message getter break error handling", () => {
    const hostile = Object.defineProperty({}, "message", {
      get() {
        throw new Error("secret from getter");
      },
    });

    expect(() => safeCadError(hostile, "connection")).not.toThrow();
    expect(safeCadError(hostile, "connection")).toBe(
      "The CAD workspace could not start. Try again or contact a workspace administrator.",
    );
  });
});
