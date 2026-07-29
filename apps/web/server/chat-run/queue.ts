import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getServerEnv } from "@foundry/config";

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
    console.error(`[redis] error host=${host} → ${detail}`);
  });
  connection.on("connect", () => {
    console.log(`[redis] connected host=${host}`);
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

export function getChatRunQueue() {
  if (!queue) {
    queue = new Queue(CHAT_RUN_QUEUE_NAME, {
      connection: queueConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    });
    queue.on("error", (err) => {
      console.error("[redis:queue:bull]", err.message || err);
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
    console.log(`[redis:queue] enqueued run ${runId}`);
    return "queued";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // BullMQ rejects duplicate jobIds — treat as already queued.
    if (/already exists/i.test(message)) {
      console.log(`[redis:queue] run ${runId} already queued`);
      return "exists";
    }
    throw err;
  }
}
