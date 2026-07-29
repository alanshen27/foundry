/**
 * Background worker: claims pending copilot runs from Postgres and executes
 * them independently of any browser HTTP connection. Stream chunks are
 * persisted and broadcast so every connected client can subscribe.
 *
 * Also drains the media-generation queue, which shares this process so a
 * deployment needs one background service rather than two.
 *
 * Run alongside the web app: pnpm worker:chat
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import { executeChatRun, HEARTBEAT_STALE_MS } from "../server/chat-run/execute";
import { Worker, type Job } from "bullmq";
import { getRedisConnection, CHAT_RUN_QUEUE_NAME } from "../server/chat-run/queue";
import { executeMediaJob, reclaimMediaJobs } from "../server/media-jobs/execute";
import { enqueueMediaJob, MEDIA_JOB_QUEUE_NAME } from "../server/media-jobs/queue";

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
    redisUrl.includes("localhost") || redisUrl.includes("127.0.0.1") || redisUrl.includes("::1");
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

if (!env.OPENAI_API_KEY) {
  console.warn(
    "[chat-worker] OPENAI_API_KEY is unset — runs will error until it is set in foundry-shared",
  );
}

if (env.NEXT_PUBLIC_REALTIME_MODE !== "supabase") {
  console.warn(
    `[chat-worker] NEXT_PUBLIC_REALTIME_MODE=${env.NEXT_PUBLIC_REALTIME_MODE} — set to "supabase" so run broadcasts reach the web UI (SSE still works via DB)`,
  );
}

const redisHost = (() => {
  try {
    return new URL(env.REDIS_URL).host;
  } catch {
    return "(unparseable REDIS_URL)";
  }
})();

const connection = getRedisConnection();
connection.on("error", (err) => {
  console.error("[chat-worker] redis error", err.message || err);
});
connection.on("connect", () => {
  console.log(`[chat-worker] redis connected host=${redisHost}`);
});

console.log(
  `[chat-worker] starting BullMQ worker… redis=${redisHost} realtime=${env.NEXT_PUBLIC_REALTIME_MODE}`,
);

const worker = new Worker(
  CHAT_RUN_QUEUE_NAME,
  async (job: Job<{ runId: string }>) => {
    const { runId } = job.data;
    console.log(`[chat-worker] run ${runId} (job ${job.id})`);
    try {
      await executeChatRun(runId);
      console.log(`[chat-worker] run ${runId} finished`);
    } catch (err) {
      console.error(`[chat-worker] run ${runId} failed`, err);
      if (isPrismaDisconnect(err)) {
        await reconnectPrisma().catch((e) => console.error("[chat-worker] reconnect failed", e));
        throw err; // Let BullMQ retry
      }
      throw err;
    }
  },
  {
    connection,
    concurrency: 10,
    // Redelivery is now harmless: executeChatRun only claims PENDING rows and
    // a redelivered job for a live attempt (fresh heartbeat) is a no-op. So a
    // short lock is safe and means a killed worker's runs fail fast instead
    // of hanging for the old 40-minute lock.
    lockDuration: 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
);

worker.on("ready", () => {
  console.log(`[chat-worker] ready on queue "${CHAT_RUN_QUEUE_NAME}"`);
});

/**
 * Media generation: low concurrency because each job is a long, billed provider
 * call, and a long lock because a still batch or video can run for minutes.
 */
const mediaWorker = new Worker(
  MEDIA_JOB_QUEUE_NAME,
  async (job: Job<{ jobId: string }>) => {
    const { jobId } = job.data;
    console.log(`[media-worker] job ${jobId}`);
    const result = await executeMediaJob(jobId);
    if (result.status === "failed") {
      // Recorded on the MediaJob row for the UI; do not retry a billed call.
      console.error(`[media-worker] job ${jobId} failed: ${result.error}`);
      return;
    }
    console.log(`[media-worker] job ${jobId} ${result.status}`);
  },
  {
    connection,
    concurrency: 2,
    lockDuration: 10 * 60_000,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  },
);

mediaWorker.on("ready", () => {
  console.log(`[media-worker] ready on queue "${MEDIA_JOB_QUEUE_NAME}"`);
});

mediaWorker.on("error", (err) => {
  console.error("[media-worker] queue error", err);
});

const mediaReclaimTimer = setInterval(() => {
  void reclaimMediaJobs(enqueueMediaJob)
    .then(({ requeued, failed }) => {
      if (requeued || failed) {
        console.warn(`[media-worker] reclaimed ${requeued} pending, failed ${failed} stale`);
      }
    })
    .catch((err) => console.error("[media-worker] reclaim loop failed", err));
}, 30_000);
mediaReclaimTimer.unref?.();

worker.on("error", (err) => {
  console.error("[chat-worker] queue error", err);
});

worker.on("failed", (job, err) => {
  console.error(`[chat-worker] job ${job?.id} failed`, err.message || err);
});

/**
 * Safety net: re-queue runs that Postgres thinks are live but Redis has no
 * active job for (enqueue miss, deploy kill, or the prior "skip RUNNING" bug
 * that marked the job complete while leaving ChatRun RUNNING).
 * Never call executeChatRun here — only enqueue.
 */
async function reclaimOrphanedRuns() {
  const now = Date.now();
  const pending = await prisma.chatRun.findMany({
    where: {
      status: "PENDING",
      // Give BullMQ a few seconds first; stop before the 45s UI timeout.
      createdAt: {
        lt: new Date(now - 4_000),
        gt: new Date(now - 40_000),
      },
    },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: { id: true, status: true },
  });
  const running = await prisma.chatRun.findMany({
    where: {
      status: "RUNNING",
      // startedAt is heartbeated every 15s by a live attempt (see execute.ts).
      // Only reclaim runs whose heartbeat is stale — re-enqueueing leads to
      // failDeadRunningAttempt, which fails them cleanly (never re-runs).
      startedAt: { lt: new Date(now - HEARTBEAT_STALE_MS) },
    },
    orderBy: { startedAt: "asc" },
    take: 5,
    select: { id: true, status: true },
  });

  const { enqueueChatRun, getChatRunQueue } = await import("../server/chat-run/queue");
  const q = getChatRunQueue();

  for (const run of [...pending, ...running]) {
    try {
      const job = await q.getJob(run.id);
      if (job) {
        const state = await job.getState();
        if (state === "active" || state === "waiting" || state === "delayed") {
          continue;
        }
        // completed/failed leftover blocks the same jobId — remove then re-add.
        await job.remove().catch(() => undefined);
      }
      console.warn(`[chat-worker] reclaiming ${run.status} run ${run.id}`);
      await enqueueChatRun(run.id);
    } catch (err) {
      console.error(`[chat-worker] reclaim ${run.id} failed`, err);
    }
  }
}

const reclaimTimer = setInterval(() => {
  void reclaimOrphanedRuns().catch((err) =>
    console.error("[chat-worker] reclaim loop failed", err),
  );
}, 5_000);
reclaimTimer.unref?.();

async function shutdown(signal: string) {
  console.log(`[chat-worker] ${signal} — closing worker`);
  clearInterval(reclaimTimer);
  clearInterval(mediaReclaimTimer);
  try {
    await worker.close();
  } catch (err) {
    console.error("[chat-worker] close failed", err);
  }
  try {
    await mediaWorker.close();
  } catch (err) {
    console.error("[media-worker] close failed", err);
  }
  try {
    await connection.quit();
  } catch {
    // ignore
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
