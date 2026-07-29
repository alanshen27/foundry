import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getServerEnv } from "@foundry/config";

let connection: IORedis | undefined;

export function getRedisConnection() {
  if (!connection) {
    const env = getServerEnv();
    const url = env.REDIS_URL.trim();
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      // keep raw
    }
    connection = new IORedis(url, {
      maxRetriesPerRequest: null, // Required by BullMQ
      // Upstash / managed Redis often need TLS via rediss://
      tls: url.startsWith("rediss://") ? {} : undefined,
    });
    connection.on("error", (err) => {
      console.error(`[redis] connection error host=${host}`, err.message || err);
    });
    connection.on("connect", () => {
      console.log(`[redis] connected host=${host}`);
    });
  }
  return connection;
}

export const CHAT_RUN_QUEUE_NAME = "chat-runs";

export function getChatRunQueue() {
  return new Queue(CHAT_RUN_QUEUE_NAME, {
    connection: getRedisConnection(),
  });
}

export async function enqueueChatRun(runId: string) {
  const queue = getChatRunQueue();
  await queue.add("execute", { runId });
}
