import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getServerEnv } from "@foundry/config";

/**
 * Prefer the raw REDIS_URL string — Upstash auth/TLS is reliable this way.
 * BullMQ accepts an options bag OR a duplicated ioredis connection.
 */
export function getRedisConnection() {
  const env = getServerEnv();
  const url = env.REDIS_URL.trim();
  return new IORedis(url, {
    maxRetriesPerRequest: null, // Required by BullMQ
    tls: url.startsWith("rediss://") ? {} : undefined,
    family: 4,
    enableReadyCheck: false,
  });
}

export const CHAT_RUN_QUEUE_NAME = "chat-runs";

let queue: Queue | undefined;
let sharedConnection: IORedis | undefined;

function queueConnection() {
  if (!sharedConnection) {
    sharedConnection = getRedisConnection();
    sharedConnection.on("error", (err) => {
      console.error("[redis:queue]", err.message || err);
    });
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

export async function enqueueChatRun(runId: string) {
  const q = getChatRunQueue();
  await q.add(
    "execute",
    { runId },
    {
      // Deduplicate rapid retries for the same run id
      jobId: runId,
    },
  );
  console.log(`[redis:queue] enqueued run ${runId}`);
}
