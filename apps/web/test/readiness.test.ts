import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkReadiness } from "../server/readiness";

const queryRaw = vi.fn();
const ping = vi.fn();

vi.mock("@foundry/db", () => ({ prisma: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }));
vi.mock("../server/chat-run/queue", () => ({
  pingRedis: () => ping(),
}));

describe("checkReadiness", () => {
  it("reports each dependency and is ready only when all pass", async () => {
    const report = await checkReadiness({
      database: async () => 1,
      redis: async () => {
        throw new Error("ECONNREFUSED secret-host:6379");
      },
    });
    expect(report).toEqual({ ok: false, checks: { database: "ok", redis: "error" } });
    expect(JSON.stringify(report)).not.toContain("secret-host");
  });

  it("times out a hung dependency instead of hanging the probe", async () => {
    const report = await checkReadiness({ database: () => new Promise(() => {}) }, 10);
    expect(report).toEqual({ ok: false, checks: { database: "timeout" } });
  });
});

describe("GET /api/ready", () => {
  beforeEach(() => {
    queryRaw.mockReset().mockResolvedValue([{ "?column?": 1 }]);
    ping.mockReset().mockResolvedValue("PONG");
  });

  it("returns 200 when Postgres and Redis respond", async () => {
    const { GET } = await import("../app/api/ready/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, checks: { database: "ok", redis: "ok" } });
  });

  it("returns 503 when the database is unreachable", async () => {
    queryRaw.mockRejectedValue(new Error("P1001"));
    const { GET } = await import("../app/api/ready/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, checks: { database: "error", redis: "ok" } });
  });
});
