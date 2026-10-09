import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getServerEnv } from "@foundry/config";
import { createLogger } from "@foundry/observability";

const log = createLogger("queue");

function redisHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable REDIS_URL)";
  }
}

/**
 * Prefer the raw REDIS_URL string — Upstash auth/TLS is reliable this way.
 * Always attach an error listener: without it, ioredis ECONNREFUSED becomes an
 * empty AggregateError that looks like a crash loop on Render.
 */
export function getRedisConnection() {
  const env = getServerEnv();
  const url = env.REDIS_URL.trim();
  const host = redisHost(url);
  const connection = new IORedis(url, {
    maxRetriesPerRequest: null, // Required by BullMQ
    tls: url.startsWith("rediss://") ? {} : undefined,
    // Prefer IPv4 — some Render→Upstash paths flap on dual-stack AggregateError.
    family: 4,
    enableReadyCheck: false,
    connectTimeout: 15_000,
    retryStrategy(times) {
      // Cap reconnect spam; BullMQ will surface failures to callers.
      if (times > 20) return null;
      return Math.min(times * 250, 5_000);
    },
  });
  connection.on("error", (err) => {
    const detail =
      err &&
      typeof err === "object" &&
      "errors" in err &&
      Array.isArray((err as AggregateError).errors)
        ? (err as AggregateError).errors
            .map((e) => {
              const n = e as { address?: string; port?: number; code?: string };
              return `${n.address ?? "?"}:${n.port ?? "?"} (${n.code ?? "?"})`;
            })
            .join(" | ")
        : err.message || String(err);
    // Reconnects flap; a warning, not an incident. BullMQ surfaces real failures.
    log.warn("redis error", { host, detail });
  });
  connection.on("connect", () => {
    log.info("redis connected", { host });
  });
  return connection;
}

export const CHAT_RUN_QUEUE_NAME = "chat-runs";

let queue: Queue | undefined;
let sharedConnection: IORedis | undefined;

function queueConnection() {
  if (!sharedConnection) {
    sharedConnection = getRedisConnection();
  }
  return sharedConnection;
}

/** Reuses the queue's connection so probes do not open one per request. */
export function pingRedis(): Promise<string> {
  return queueConnection().ping();
}

export function getChatRunQueue() {
  if (!queue) {
    queue = new Queue(CHAT_RUN_QUEUE_NAME, {
      connection: queueConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        // One attempt by default. A retried copilot job re-enters a run that
        // has already spent model steps and Zoo generations, so a retry is a
        // second bill for the same turn. enqueueChatRun also sets this per
        // job; the default is here so a future job type on this queue does not
        // silently inherit three attempts.
        attempts: 1,
      },
    });
    queue.on("error", (err) => {
      log.error("chat queue error", { err });
    });
  }
  return queue;
}

export async function enqueueChatRun(runId: string): Promise<"queued" | "exists"> {
  const q = getChatRunQueue();
  try {
    await q.add(
      "execute",
      { runId },
      {
        // Deduplicate rapid retries for the same run id
        jobId: runId,
        // Retries re-enter mid-stream and can double-bill Zoo; reclaimPendingRuns
        // re-enqueues misses without calling execute directly.
        attempts: 1,
      },
    );
    log.info("enqueued run", { runId });
    return "queued";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // BullMQ rejects duplicate jobIds — treat as already queued.
    if (/already exists/i.test(message)) {
      log.info("run already queued", { runId });
      return "exists";
    }
    throw err;
  }
}
