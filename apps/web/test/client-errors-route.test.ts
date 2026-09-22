/**
 * /api/client-errors is unauthenticated by necessity — the sign-in page can
 * crash — which makes it an open write endpoint. These pin its limits.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const rateLimit = vi.fn();
const reports: { error: unknown; context: { fields?: Record<string, unknown> } }[] = [];

vi.mock("@/server/rate-limit", () => ({
  clientIp: () => "203.0.113.1",
  policies: () => ({ clientErrors: { name: "client-errors", limit: 20, windowMs: 60_000 } }),
  rateLimit: (...a: unknown[]) => rateLimit(...a),
}));

const { configureObservability } = await import("@foundry/observability");
const { POST } = await import("../app/api/client-errors/route");

const post = (body: unknown, raw?: string) =>
  POST(
    new Request("http://localhost/api/client-errors", {
      method: "POST",
      body: raw ?? JSON.stringify(body),
    }),
  );

beforeEach(() => {
  reports.length = 0;
  rateLimit.mockReset().mockResolvedValue({ allowed: true });
  configureObservability({
    sink: () => {},
    reporter: {
      capture: (error, context) => reports.push({ error, context: context as never }),
    },
  });
});

describe("POST /api/client-errors", () => {
  it("relays a browser error into the error reporter", async () => {
    const response = await post({
      message: "Cannot read properties of undefined",
      name: "TypeError",
      stack: "TypeError: ...\n    at ImpactPanel",
      digest: "abc123",
      url: "https://gofoundry.app/w/x",
      boundary: "segment",
    });
    expect(response.status).toBe(202);
    expect(reports).toHaveLength(1);
    const error = reports[0]!.error as Error;
    expect(error.name).toBe("TypeError");
    expect(error.stack).toContain("ImpactPanel");
    expect(reports[0]!.context.fields).toMatchObject({ boundary: "segment", digest: "abc123" });
  });

  it("rejects an oversized body without parsing it", async () => {
    const response = await post(null, "x".repeat(20_000));
    expect(response.status).toBe(413);
    expect(reports).toHaveLength(0);
  });

  it("rejects malformed JSON and invalid shapes", async () => {
    expect((await post(null, "{not json")).status).toBe(400);
    expect((await post({ nope: true })).status).toBe(400);
    expect((await post({ message: "x".repeat(5_000) })).status).toBe(400);
    expect(reports).toHaveLength(0);
  });

  it("accepts but drops reports over the rate limit", async () => {
    // A crashing page must not see failed requests on top of its crash.
    rateLimit.mockResolvedValue({ allowed: false });
    const response = await post({ message: "loop" });
    expect(response.status).toBe(202);
    expect(reports).toHaveLength(0);
  });
});
