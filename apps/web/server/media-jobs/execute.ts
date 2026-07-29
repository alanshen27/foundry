import "server-only";
import { prisma, type ProductMedia } from "@foundry/db";
import {
  generateStillsInputSchema,
  generateVideoInputSchema,
  mediaExtension,
  productMediaKey,
} from "@foundry/domain";
import { buildMediaPrompt } from "@foundry/media";
import { recordAudit } from "../audit";
import { getMediaGenerator } from "../media";
import { getObjectStorage } from "../storage";
import { loadProductContext, toMediaPromptContext } from "../product-context";

/** A RUNNING job older than this is treated as abandoned by a dead worker. */
export const MEDIA_JOB_STALE_MS = 20 * 60_000;

export type MediaJobResult =
  | { status: "skipped"; reason: string }
  | { status: "succeeded"; created: number; failures: string[] }
  | { status: "failed"; error: string };

/**
 * Executes one queued media job.
 *
 * Claiming is a conditional update, so a redelivered BullMQ job for a run that
 * already started is a no-op rather than a second paid generation.
 */
export async function executeMediaJob(jobId: string): Promise<MediaJobResult> {
  const claimed = await prisma.mediaJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (claimed.count === 0) {
    return { status: "skipped", reason: "job is not PENDING" };
  }

  const job = await prisma.mediaJob.findUnique({ where: { id: jobId } });
  if (!job) return { status: "skipped", reason: "job disappeared" };

  try {
    const result =
      job.type === "GENERATE_VIDEO"
        ? await runVideoJob(job.id, job.projectId, job.workspaceId, job.createdById, job.input)
        : await runStillsJob(job.id, job.projectId, job.workspaceId, job.createdById, job.input);

    const status = result.created > 0 ? "SUCCEEDED" : "FAILED";
    await prisma.mediaJob.update({
      where: { id: job.id },
      data: {
        status,
        error: result.failures.length ? result.failures.join("; ") : null,
        finishedAt: new Date(),
      },
    });
    await recordAudit({
      type: "MediaJobFinished",
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      actorId: job.createdById,
      actorType: "SYSTEM",
      payload: {
        jobId: job.id,
        status,
        created: result.created,
        failures: result.failures,
      },
    });

    if (result.created === 0) {
      return { status: "failed", error: result.failures.join("; ") || "Generation failed" };
    }
    return { status: "succeeded", created: result.created, failures: result.failures };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await prisma.mediaJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error, finishedAt: new Date() },
    });
    await recordAudit({
      type: "MediaJobFinished",
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      actorId: job.createdById,
      actorType: "SYSTEM",
      payload: { jobId: job.id, status: "FAILED", error },
    });
    return { status: "failed", error };
  }
}

/** One still per requested role, each with its own grounded prompt. */
async function runStillsJob(
  jobId: string,
  projectId: string,
  workspaceId: string,
  createdById: string,
  rawInput: unknown,
): Promise<{ created: number; failures: string[] }> {
  const input = generateStillsInputSchema.parse(rawInput);
  const { context, releaseId } = await loadProductContext(projectId);
  const promptContext = toMediaPromptContext(context);
  const generator = getMediaGenerator();
  const storage = getObjectStorage();

  const failures: string[] = [];
  let created = 0;

  for (const [index, role] of input.roles.entries()) {
    const prompt = buildMediaPrompt({
      context: promptContext,
      role,
      userPrompt: input.prompt,
    });
    const result = await generator.generateStills({
      prompt,
      count: 1,
      aspectRatio: input.aspectRatio,
    });
    if (!result.ok) {
      failures.push(`${role}: ${result.error}`);
      continue;
    }
    const still = result.data[0];
    if (!still) {
      failures.push(`${role}: generator returned no image`);
      continue;
    }

    const key = productMediaKey({
      projectId,
      batchId: jobId,
      filename: `${index}-${role.toLowerCase()}.${mediaExtension(still.mimeType)}`,
    });
    const stored = await storage.put(key, still.bytes, still.mimeType);

    const media = await prisma.productMedia.create({
      data: {
        workspaceId,
        projectId,
        releaseId: input.releaseId ?? releaseId,
        kind: "STILL",
        role,
        source: "AI_IMAGE",
        storageKey: key,
        mimeType: still.mimeType,
        sha256: stored.sha256,
        sizeBytes: stored.sizeBytes,
        width: still.width,
        height: still.height,
        prompt,
        generator: still.generator,
        simulated: still.simulated,
        jobId,
        createdById,
      },
    });
    created += 1;
    await auditCreated(media, workspaceId, createdById, { role, jobId });
  }

  return { created, failures };
}

async function runVideoJob(
  jobId: string,
  projectId: string,
  workspaceId: string,
  createdById: string,
  rawInput: unknown,
): Promise<{ created: number; failures: string[] }> {
  const input = generateVideoInputSchema.parse(rawInput);
  const { context, releaseId } = await loadProductContext(projectId);
  const storage = getObjectStorage();

  let seedImage: { bytes: Uint8Array; mimeType: string } | undefined;
  let seedKey: string | null = null;
  if (input.seedMediaId) {
    const seed = await prisma.productMedia.findUnique({ where: { id: input.seedMediaId } });
    if (!seed || seed.projectId !== projectId || seed.kind !== "STILL") {
      return { created: 0, failures: ["Seed image is missing or is not a still"] };
    }
    const object = await storage.get(seed.storageKey);
    if (!object) return { created: 0, failures: ["Seed image bytes are missing"] };
    seedImage = { bytes: object.body, mimeType: object.contentType };
    seedKey = seed.storageKey;
  }

  const prompt = buildMediaPrompt({
    context: toMediaPromptContext(context),
    role: "HERO",
    userPrompt: input.prompt,
    motion: true,
  });
  const result = await getMediaGenerator().generateVideo({
    prompt,
    durationSec: input.durationSec,
    seedImage,
  });
  if (!result.ok) return { created: 0, failures: [result.error] };

  const video = result.data;
  const key = productMediaKey({
    projectId,
    batchId: jobId,
    filename: `video.${mediaExtension(video.mimeType)}`,
  });
  const stored = await storage.put(key, video.bytes, video.mimeType);

  let posterKey = seedKey;
  if (!posterKey && video.poster) {
    posterKey = productMediaKey({
      projectId,
      batchId: jobId,
      filename: `poster.${mediaExtension(video.poster.mimeType)}`,
    });
    await storage.put(posterKey, video.poster.bytes, video.poster.mimeType);
  }

  const media = await prisma.productMedia.create({
    data: {
      workspaceId,
      projectId,
      releaseId: input.releaseId ?? releaseId,
      kind: "VIDEO",
      role: "HERO",
      source: "AI_VIDEO",
      storageKey: key,
      mimeType: video.mimeType,
      sha256: stored.sha256,
      sizeBytes: stored.sizeBytes,
      durationMs: video.durationMs,
      posterStorageKey: posterKey,
      prompt,
      generator: video.generator,
      simulated: video.simulated,
      jobId,
      createdById,
    },
  });
  await auditCreated(media, workspaceId, createdById, { kind: "VIDEO", jobId });

  return { created: 1, failures: [] };
}

async function auditCreated(
  media: ProductMedia,
  workspaceId: string,
  actorId: string,
  extra: Record<string, unknown>,
): Promise<void> {
  await recordAudit({
    type: "ProductMediaCreated",
    workspaceId,
    projectId: media.projectId,
    actorId,
    payload: { mediaId: media.id, simulated: media.simulated, ...extra },
  });
}

/**
 * Safety net for jobs Postgres thinks are live but no worker is running:
 * re-enqueues stuck PENDING rows and fails RUNNING rows whose worker died,
 * so the UI never polls a job forever.
 */
export async function reclaimMediaJobs(
  enqueue: (jobId: string) => Promise<unknown>,
): Promise<{ requeued: number; failed: number }> {
  const now = Date.now();

  const pending = await prisma.mediaJob.findMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now - 15_000) } },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: { id: true },
  });
  for (const job of pending) {
    await enqueue(job.id).catch((err) =>
      console.error(`[media-worker] re-enqueue ${job.id} failed`, err),
    );
  }

  const stale = await prisma.mediaJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(now - MEDIA_JOB_STALE_MS) } },
    data: {
      status: "FAILED",
      error: "Worker stopped before the job finished",
      finishedAt: new Date(),
    },
  });

  return { requeued: pending.length, failed: stale.count };
}
