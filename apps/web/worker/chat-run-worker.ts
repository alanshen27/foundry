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

// .env.local first: dotenv never overrides a variable that is already set, so
// this order lets local overrides win. Loading only .env meant a locally run
// worker used whatever .env held — which was the production database and the
// production job queue.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import { executeChatRun, HEARTBEAT_STALE_MS } from "../server/chat-run/execute";
import { Worker, type Job } from "bullmq";
import { getRedisConnection, CHAT_RUN_QUEUE_NAME } from "../server/chat-run/queue";
import { executeMediaJob, reclaimMediaJobs } from "../server/media-jobs/execute";
import { enqueueMediaJob, MEDIA_JOB_QUEUE_NAME } from "../server/media-jobs/queue";
import { createLogger, getErrorReporter } from "@foundry/observability";
import { initObservability } from "@foundry/observability/sentry";

const observability = initObservability({
  service: "foundry-chat-worker",
  sentryDsn: process.env.SENTRY_DSN?.trim() || undefined,
  environment: process.env.RENDER ? "production" : (process.env.NODE_ENV ?? "development"),
  release: process.env.RENDER_GIT_COMMIT,
});
const log = createLogger("chat-worker");
const mediaLog = createLogger("media-worker");

// Record, flush, then exit exactly as Node would have. Installing a handler
// suppresses Node's own crash, and a worker left running after an uncaught
// exception may hold a half-finished run; the platform restarting it cleanly
// is the safer outcome. What changes is that the cause is now recorded.
async function die(kind: string, err: unknown) {
  log.error(kind, { err });
  await getErrorReporter().flush?.(2_000);
  process.exit(1);
}
process.on("unhandledRejection", (reason) => void die("unhandled rejection", reason));
process.on("uncaughtException", (err) => void die("uncaught exception", err));

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
  log.warn("prisma connection lost, reconnecting");
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  await new Promise((r) => setTimeout(r, 500));
  await prisma.$connect();
  log.info("prisma reconnected");
}

function assertProdRedis(redisUrl: string) {
  const isLocal =
    redisUrl.includes("localhost") || redisUrl.includes("127.0.0.1") || redisUrl.includes("::1");
  if (process.env.RENDER || process.env.NODE_ENV === "production") {
    if (isLocal) {
      log.error(
        "REDIS_URL points at localhost. On Render set foundry-shared REDIS_URL to your Upstash rediss:// URL.",
      );
      process.exit(1);
    }
  }
}

const env = getServerEnv();
assertProdRedis(env.REDIS_URL);

// BullMQ records this on each job as processedBy. An explicit implementation
// version makes a stale hosted consumer distinguishable from the local worker.
const workerName = `foundry-chat-python-cad-v4-${process.env.RENDER ? "render" : "local"}-${process.pid}`;

if (!env.OPENAI_API_KEY) {
  log.warn("OPENAI_API_KEY is unset; runs will error until it is set in foundry-shared");
}

if (env.NEXT_PUBLIC_REALTIME_MODE !== "supabase") {
  log.warn(
    'realtime mode is not "supabase", so run broadcasts will not reach the web UI (SSE still works via DB)',
    { realtimeMode: env.NEXT_PUBLIC_REALTIME_MODE },
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
  log.warn("redis error", { host: redisHost, err });
});
connection.on("connect", () => {
  log.info("redis connected", { host: redisHost });
});

log.info("starting", {
  redis: redisHost,
  realtime: env.NEXT_PUBLIC_REALTIME_MODE,
  errorReporting: observability.sentry ? "sentry" : "logs only",
  model: env.AI_MODEL,
  name: workerName,
});

const worker = new Worker(
  CHAT_RUN_QUEUE_NAME,
  async (job: Job<{ runId: string }>) => {
    const { runId } = job.data;
    const runLog = log.child({ runId, jobId: job.id });
    runLog.info("run started");
    try {
      await executeChatRun(runId);
      runLog.info("run finished");
    } catch (err) {
      runLog.error("run failed", { err });
      if (isPrismaDisconnect(err)) {
        await reconnectPrisma().catch((e) => runLog.error("prisma reconnect failed", { err: e }));
        throw err; // Let BullMQ retry
      }
      throw err;
    }
  },
  {
    name: workerName,
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
  log.info("ready", { queue: CHAT_RUN_QUEUE_NAME });
});

/**
 * Media generation: low concurrency because each job is a long, billed provider
 * call, and a long lock because a still batch or video can run for minutes.
 */
const mediaWorker = new Worker(
  MEDIA_JOB_QUEUE_NAME,
  async (job: Job<{ jobId: string }>) => {
    const { jobId } = job.data;
    mediaLog.info("job started", { jobId });
    const result = await executeMediaJob(jobId);
    if (result.status === "failed") {
      // Recorded on the MediaJob row for the UI; do not retry a billed call.
      mediaLog.error("job failed", { jobId, reason: result.error });
      return;
    }
    mediaLog.info("job finished", { jobId, status: result.status });
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
  mediaLog.info("ready", { queue: MEDIA_JOB_QUEUE_NAME });
});

mediaWorker.on("error", (err) => {
  mediaLog.error("queue error", { err });
});

const mediaReclaimTimer = setInterval(() => {
  void reclaimMediaJobs(enqueueMediaJob)
    .then(({ requeued, failed }) => {
      if (requeued || failed) {
        mediaLog.warn("reclaimed jobs", { requeued, failedStale: failed });
      }
    })
    .catch((err) => mediaLog.error("reclaim loop failed", { err }));
}, 30_000);
mediaReclaimTimer.unref?.();

worker.on("error", (err) => {
  log.error("queue error", { err });
});

worker.on("failed", (job, err) => {
  // Already reported by the processor; this is the queue's own bookkeeping.
  log.warn("job failed", { jobId: job?.id, err });
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
      log.warn("reclaiming orphaned run", { runId: run.id, status: run.status });
      await enqueueChatRun(run.id);
    } catch (err) {
      log.error("reclaim failed", { runId: run.id, err });
    }
  }
}

const reclaimTimer = setInterval(() => {
  void reclaimOrphanedRuns().catch((err) => log.error("reclaim loop failed", { err }));
}, 5_000);
reclaimTimer.unref?.();

async function shutdown(signal: string) {
  log.info("shutting down", { signal });
  clearInterval(reclaimTimer);
  clearInterval(mediaReclaimTimer);
  try {
    await worker.close();
  } catch (err) {
    log.error("close failed", { err });
  }
  try {
    await mediaWorker.close();
  } catch (err) {
    mediaLog.error("close failed", { err });
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
  // Reports are sent asynchronously; exiting straight away drops the last ones,
  // which are usually the ones explaining why the worker is going down.
  await getErrorReporter().flush?.(2_000);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
