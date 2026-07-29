/**
 * Background worker: claims pending copilot runs from Postgres and executes
 * them independently of any browser HTTP connection. Stream chunks are
 * persisted and broadcast so every connected client can subscribe.
 *
 * Run alongside the web app: pnpm worker:chat
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import { executeChatRun } from "../server/chat-run/execute";
import { Worker, type Job } from "bullmq";
import { getRedisConnection, CHAT_RUN_QUEUE_NAME } from "../server/chat-run/queue";

function isPrismaDisconnect(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Can't reach database") ||
    message.includes("connection closed") ||
    message.includes("terminating connection")
  );
}

async function reconnectPrisma(): Promise<void> {
  console.warn("[chat-worker] prisma connection lost — reconnecting…");
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  await new Promise((r) => setTimeout(r, 500));
  await prisma.$connect();
  console.log("[chat-worker] prisma reconnected");
}

function assertProdRedis(redisUrl: string) {
  const isLocal =
    redisUrl.includes("localhost") ||
    redisUrl.includes("127.0.0.1") ||
    redisUrl.includes("::1");
  if (process.env.RENDER || process.env.NODE_ENV === "production") {
    if (isLocal) {
      console.error(
        "[chat-worker] REDIS_URL points at localhost. On Render set foundry-shared REDIS_URL to your Upstash rediss:// URL.",
      );
      process.exit(1);
    }
  }
}

const env = getServerEnv();
assertProdRedis(env.REDIS_URL);

const redisHost = (() => {
  try {
    return new URL(env.REDIS_URL).host;
  } catch {
    return "(unparseable REDIS_URL)";
  }
})();

console.log(`[chat-worker] starting BullMQ worker… redis=${redisHost}`);

const worker = new Worker(
  CHAT_RUN_QUEUE_NAME,
  async (job: Job<{ runId: string }>) => {
    const { runId } = job.data;
    console.log(`[chat-worker] run ${runId}`);
    try {
      await executeChatRun(runId);
      console.log(`[chat-worker] run ${runId} finished`);
    } catch (err) {
      console.error(`[chat-worker] run ${runId} failed`, err);
      if (isPrismaDisconnect(err)) {
        await reconnectPrisma().catch((e) =>
          console.error("[chat-worker] reconnect failed", e),
        );
        throw err; // Let BullMQ retry
      }
      throw err;
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: 10,
  },
);

worker.on("ready", () => {
  console.log(`[chat-worker] ready on queue "${CHAT_RUN_QUEUE_NAME}"`);
});

worker.on("error", (err) => {
  console.error("[chat-worker] queue error", err);
});

async function shutdown(signal: string) {
  console.log(`[chat-worker] ${signal} — closing worker`);
  try {
    await worker.close();
  } catch (err) {
    console.error("[chat-worker] close failed", err);
  }
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
