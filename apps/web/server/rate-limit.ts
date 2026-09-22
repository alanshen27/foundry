/**
 * Request rate limiting.
 *
 * Every expensive or abusable entry point goes through here: a copilot turn
 * can spend two dozen model steps and several multi-minute Zoo generations,
 * and the credential routes are the first thing anyone scripting against the
 * app will hammer. Before this there was no limit on any of them.
 *
 * The algorithm is a sliding-window approximation: the current fixed window's
 * count plus the previous window's count weighted by how much of it still
 * overlaps. It costs two counters per key, and unlike a plain fixed window it
 * does not let a caller spend twice the limit by straddling a boundary.
 *
 * Counters live in Redis so the limit holds across every web instance. If
 * Redis is unreachable the limiter degrades to an in-process counter rather
 * than failing open — per-instance limits are weaker, but "no limit at all
 * while Redis is down" is exactly when a runaway loop costs the most — and
 * rather than failing closed, which would take the copilot down with Redis.
 */

import IORedis from "ioredis";
import { getServerEnv } from "@foundry/config";
import { createLogger } from "@foundry/observability";

const log = createLogger("rate-limit");

export type RateLimitPolicy = {
  /** Stable name, part of the storage key. */
  name: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  /** Requests left in the current window, never negative. */
  remaining: number;
  /** Milliseconds until a request would be allowed again. 0 when allowed. */
  retryAfterMs: number;
};

/** Increment-and-read of one fixed-window counter. */
export interface RateLimitStore {
  /** Adds one to `key`, expiring it after `ttlMs`, and returns the new count. */
  increment(key: string, ttlMs: number): Promise<number>;
  /** Current count for `key`, 0 if absent. */
  get(key: string): Promise<number>;
}

/** Per-process store. The fallback, and what tests use. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async increment(key: string, ttlMs: number): Promise<number> {
    const at = this.now();
    const entry = this.counters.get(key);
    if (!entry || entry.expiresAt <= at) {
      this.counters.set(key, { count: 1, expiresAt: at + ttlMs });
      this.sweep(at);
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  async get(key: string): Promise<number> {
    const entry = this.counters.get(key);
    return entry && entry.expiresAt > this.now() ? entry.count : 0;
  }

  /** Bounds memory: drop expired counters once the map gets large. */
  private sweep(at: number) {
    if (this.counters.size < 10_000) return;
    for (const [key, entry] of this.counters) {
      if (entry.expiresAt <= at) this.counters.delete(key);
    }
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: IORedis) {}

  async increment(key: string, ttlMs: number): Promise<number> {
    const results = await this.redis.multi().incr(key).pexpire(key, ttlMs, "NX").exec();
    const count = results?.[0]?.[1];
    if (typeof count !== "number") throw new Error("rate limit INCR returned no count");
    return count;
  }

  async get(key: string): Promise<number> {
    const value = await this.redis.get(key);
    return value ? Number(value) : 0;
  }
}

/**
 * Checks and consumes one request against a policy.
 *
 * Pure apart from the store and the clock, both injected, so the window maths
 * is tested without Redis or real time.
 */
export async function consume(
  store: RateLimitStore,
  policy: RateLimitPolicy,
  identifier: string,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const window = Math.floor(now / policy.windowMs);
  const elapsed = (now % policy.windowMs) / policy.windowMs;
  const base = `rl:${policy.name}:${identifier}`;
  const currentKey = `${base}:${window}`;
  const previousKey = `${base}:${window - 1}`;

  const previous = await store.get(previousKey);
  const weightedPrevious = previous * (1 - elapsed);

  // Refuse before incrementing, so a caller hammering a closed limit does not
  // keep pushing its own reset further away.
  const before = await store.get(currentKey);
  if (before + weightedPrevious >= policy.limit) {
    return {
      allowed: false,
      limit: policy.limit,
      remaining: 0,
      retryAfterMs: retryAfter(policy, now, before, previous),
    };
  }

  // Two windows of TTL: the counter must survive as next window's "previous".
  const current = await store.increment(currentKey, policy.windowMs * 2);
  const used = current + weightedPrevious;
  return {
    allowed: used <= policy.limit,
    limit: policy.limit,
    remaining: Math.max(0, Math.floor(policy.limit - used)),
    retryAfterMs: used <= policy.limit ? 0 : retryAfter(policy, now, current, previous),
  };
}

/**
 * When the weighted count next drops below the limit.
 *
 * The previous window's share decays linearly across this window, so solve
 * `current + previous * (1 - t) < limit` for t. If the current window alone is
 * already at the limit, nothing frees up until it rolls over.
 */
function retryAfter(policy: RateLimitPolicy, now: number, current: number, previous: number) {
  const windowEnd = (Math.floor(now / policy.windowMs) + 1) * policy.windowMs;
  if (current >= policy.limit || previous === 0) return Math.max(1, windowEnd - now);
  const fraction = 1 - (policy.limit - current) / previous;
  const windowStart = windowEnd - policy.windowMs;
  const at = windowStart + Math.max(0, fraction) * policy.windowMs;
  return Math.max(1, Math.ceil(at - now));
}

// ---------- policies ----------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function policies() {
  const env = getServerEnv();
  return {
    /** A burst guard: a loop re-sending @AI stops within seconds. */
    aiRunBurst: { name: "ai-run-min", limit: 5, windowMs: MINUTE },
    /** Sustained per-user ceiling, tunable because it is the cost dial. */
    aiRunHourly: { name: "ai-run-hour", limit: env.AI_RUNS_PER_HOUR, windowMs: HOUR },
    /** The light-model "did you mean to ping @AI?" triage on plain messages. */
    aiTriage: { name: "ai-triage", limit: 30, windowMs: MINUTE },
    /** Per account: slows guessing one person's password. */
    signInEmail: { name: "signin-email", limit: 10, windowMs: 10 * MINUTE },
    /** Per address: slows spraying many accounts from one place. */
    signInIp: { name: "signin-ip", limit: 30, windowMs: 10 * MINUTE },
    signUpIp: { name: "signup-ip", limit: 5, windowMs: HOUR },
    /** Browser error reports: enough for a real crash loop, not for a flood. */
    clientErrors: { name: "client-errors", limit: 20, windowMs: MINUTE },
  } satisfies Record<string, RateLimitPolicy>;
}

// ---------- store selection ----------

let redisStore: RedisRateLimitStore | null = null;
let redisDisabledUntil = 0;
const memoryStore = new MemoryRateLimitStore();
/** A limiter that takes longer than this is slower than the fallback is wrong. */
const REDIS_TIMEOUT_MS = 750;
/** After a Redis failure, skip it for a while instead of timing out every call. */
const REDIS_BACKOFF_MS = 30_000;

function getRedisStore(): RedisRateLimitStore {
  if (!redisStore) {
    const url = getServerEnv().REDIS_URL.trim();
    const redis = new IORedis(url, {
      // Fail fast. BullMQ's connection waits forever for Redis to return, which
      // is right for a job queue and wrong for a check on a request path.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
      tls: url.startsWith("rediss://") ? {} : undefined,
      family: 4,
      lazyConnect: false,
    });
    redis.on("error", (err) => {
      log.warn("redis error", { err });
    });
    redisStore = new RedisRateLimitStore(redis);
  }
  return redisStore;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Consumes one request, preferring Redis and degrading to in-process counting. */
export async function rateLimit(
  policy: RateLimitPolicy,
  identifier: string,
): Promise<RateLimitResult> {
  if (Date.now() >= redisDisabledUntil) {
    try {
      return await withTimeout(consume(getRedisStore(), policy, identifier), REDIS_TIMEOUT_MS);
    } catch (err) {
      redisDisabledUntil = Date.now() + REDIS_BACKOFF_MS;
      log.warn("redis unavailable; using per-process limits", {
        backoffSeconds: REDIS_BACKOFF_MS / 1000,
        err,
      });
    }
  }
  return consume(memoryStore, policy, identifier);
}

/**
 * Checks several policies; the first refusal wins and names its policy, so
 * the caller can say "per minute" or "per hour" without guessing.
 */
export async function rateLimitAll(
  checks: { policy: RateLimitPolicy; identifier: string }[],
): Promise<RateLimitResult & { policy: RateLimitPolicy | null }> {
  let last: RateLimitResult | null = null;
  for (const { policy, identifier } of checks) {
    last = await rateLimit(policy, identifier);
    if (!last.allowed) return { ...last, policy };
  }
  return {
    ...(last ?? { allowed: true, limit: Infinity, remaining: Infinity, retryAfterMs: 0 }),
    policy: null,
  };
}

/** "minute", "10 minutes", "hour" — for messages that quote a policy window. */
export function describeWindow(windowMs: number): string {
  const minutes = Math.round(windowMs / 60_000);
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "hour" : `${hours} hours`;
  }
  return minutes === 1 ? "minute" : `${minutes} minutes`;
}

/**
 * The caller's address for per-IP limits.
 *
 * Render terminates TLS and sets x-forwarded-for with the client first. Only
 * trust it as a rate-limit key, never for anything security-sensitive: a
 * client can prepend entries, which at worst gives it a different bucket —
 * and the per-account limits still apply.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** The standard 429, with Retry-After in whole seconds. */
export function tooManyRequests(
  result: RateLimitResult,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return Response.json(
    { ...extra, error: message, retryAfterSeconds: seconds },
    {
      status: 429,
      headers: {
        "Retry-After": String(seconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}
