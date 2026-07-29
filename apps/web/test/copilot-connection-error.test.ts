import { describe, expect, it } from "vitest";
import { isConnectionError } from "@/lib/copilot/connection-error";

describe("isConnectionError", () => {
  it("classifies browser fetch/network failures as connection errors", () => {
    expect(isConnectionError(new TypeError("Failed to fetch"))).toBe(true); // Chrome POST
    expect(isConnectionError(new TypeError("network error"))).toBe(true); // Chrome mid-stream
    expect(
      isConnectionError(new TypeError("NetworkError when attempting to fetch resource.")),
    ).toBe(true); // Firefox
    expect(isConnectionError(new TypeError("Load failed"))).toBe(true); // Safari
    expect(isConnectionError(new Error("The network connection was lost."))).toBe(true); // Safari
    expect(isConnectionError(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe(true);
  });

  it("does not classify run/server failures as connection errors", () => {
    expect(isConnectionError(new Error("workspace is locked"))).toBe(false);
    expect(isConnectionError(new Error("OPENAI_API_KEY is not configured"))).toBe(false);
    expect(isConnectionError(new Error("Failed to start copilot run"))).toBe(false);
    expect(
      isConnectionError(
        new Error("The chat worker restarted while this reply was in flight. Send the message again."),
      ),
    ).toBe(false);
    expect(isConnectionError("network error")).toBe(false); // non-Error values
    expect(isConnectionError(undefined)).toBe(false);
  });
});
