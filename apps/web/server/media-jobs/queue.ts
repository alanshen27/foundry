import "server-only";
import { Queue } from "bullmq";
import type IORedis from "ioredis";
import { getRedisConnection } from "../chat-run/queue";

export const MEDIA_JOB_QUEUE_NAME = "media-jobs";

let queue: Queue | undefined;
let connection: IORedis | undefined;

function queueConnection() {
  if (!connection) connection = getRedisConnection();
  return connection;
}

/**
 * Queue for image/video generation. Media generation is minutes-long and must
 * not run inside an HTTP request, where a platform timeout would abandon a
 * paid provider call mid-flight.
 */
export function getMediaJobQueue(): Queue {
  if (!queue) {
    queue = new Queue(MEDIA_JOB_QUEUE_NAME, {
      connection: queueConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        // Generation is billed per call, so a retry would double-charge for
        // work that may have partially succeeded. Failures surface on the row.
        attempts: 1,
      },
    });
    queue.on("error", (err) => {
      console.error("[redis:queue:media]", err instanceof Error ? err.message : err);
    });
  }
  return queue;
}

export async function enqueueMediaJob(jobId: string): Promise<"queued" | "exists"> {
  try {
    await getMediaJobQueue().add("execute", { jobId }, { jobId, attempts: 1 });
    console.log(`[redis:queue] enqueued media job ${jobId}`);
    return "queued";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(message)) return "exists";
    throw err;
  }
}
