import { describe, expect, it, vi } from "vitest";

vi.mock("@foundry/config", () => ({
  getServerEnv: () => ({ AI_RUNS_PER_HOUR: 30, REDIS_URL: "redis://127.0.0.1:1" }),
}));

const { MemoryRateLimitStore, clientIp, consume, describeWindow, tooManyRequests } =
  await import("../server/rate-limit");

const policy = { name: "t", limit: 3, windowMs: 60_000 };

/** A store whose clock the test controls. */
function clocked(start: number) {
  let now = start;
  const store = new MemoryRateLimitStore(() => now);
  return {
    store,
    at: (t: number) => {
      now = t;
      return t;
    },
  };
}

describe("consume", () => {
  it("allows up to the limit and refuses the next request", async () => {
    const { store } = clocked(0);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consume(store, policy, "u1", 1_000));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[2]!.remaining).toBe(0);
    expect(results[3]!.retryAfterMs).toBeGreaterThan(0);
  });

  it("keeps separate identities separate", async () => {
    const { store } = clocked(0);
    for (let i = 0; i < 3; i++) await consume(store, policy, "a", 1_000);
    expect((await consume(store, policy, "a", 1_000)).allowed).toBe(false);
    expect((await consume(store, policy, "b", 1_000)).allowed).toBe(true);
  });

  it("does not let a caller double the limit by straddling a window boundary", async () => {
    // A plain fixed window would allow 3 at 59.9s and 3 more at 60.1s.
    const { store, at } = clocked(0);
    for (let i = 0; i < 3; i++) await consume(store, policy, "u", at(59_900));
    const justAfter = await consume(store, policy, "u", at(60_100));
    expect(justAfter.allowed).toBe(false);
  });

  it("frees capacity as the previous window's weight decays", async () => {
    const { store, at } = clocked(0);
    for (let i = 0; i < 3; i++) await consume(store, policy, "u", at(59_000));
    // Half way through the next window, the previous 3 count as 1.5.
    expect((await consume(store, policy, "u", at(90_000))).allowed).toBe(true);
  });

  it("fully resets after two quiet windows", async () => {
    const { store, at } = clocked(0);
    for (let i = 0; i < 3; i++) await consume(store, policy, "u", at(1_000));
    for (let i = 0; i < 3; i++) {
      expect((await consume(store, policy, "u", at(125_000))).allowed).toBe(true);
    }
  });

  it("does not extend its own lockout by counting refused requests", async () => {
    const { store } = clocked(0);
    for (let i = 0; i < 3; i++) await consume(store, policy, "u", 1_000);
    for (let i = 0; i < 20; i++) await consume(store, policy, "u", 1_000);
    expect(await store.get("rl:t:u:0")).toBe(3);
  });

  it("tells a refused caller when to come back", async () => {
    const { store } = clocked(0);
    for (let i = 0; i < 3; i++) await consume(store, policy, "u", 10_000);
    const refused = await consume(store, policy, "u", 10_000);
    // The current window alone is full, so nothing frees before it rolls over.
    expect(refused.retryAfterMs).toBe(50_000);
  });
});

describe("clientIp", () => {
  it("takes the first forwarded address", () => {
    const request = new Request("http://x", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientIp(request)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then a shared bucket", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "198.51.100.2" } }))).toBe(
      "198.51.100.2",
    );
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});

describe("tooManyRequests", () => {
  it("returns 429 with Retry-After in whole seconds", async () => {
    const response = tooManyRequests(
      { allowed: false, limit: 5, remaining: 0, retryAfterMs: 1_200 },
      "slow down",
      { persisted: true },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(await response.json()).toEqual({
      persisted: true,
      error: "slow down",
      retryAfterSeconds: 2,
    });
  });
});

describe("describeWindow", () => {
  it.each([
    [60_000, "minute"],
    [600_000, "10 minutes"],
    [3_600_000, "hour"],
    [86_400_000, "24 hours"],
  ])("%i ms reads as %s", (ms, text) => {
    expect(describeWindow(ms)).toBe(text);
  });
});

describe("rateLimit when Redis is unreachable", () => {
  it("degrades to per-process limits instead of failing open", async () => {
    const { rateLimit } = await import("../server/rate-limit");
    const tight = { name: `fallback-${Date.now()}`, limit: 2, windowMs: 60_000 };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const results = [];
    for (let i = 0; i < 3; i++) results.push((await rateLimit(tight, "u")).allowed);
    warn.mockRestore();
    expect(results).toEqual([true, true, false]);
  }, 10_000);
});
