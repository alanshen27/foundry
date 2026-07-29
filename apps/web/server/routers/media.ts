import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma, type Prisma, type ProductMedia } from "@foundry/db";
import {
  canAttachToSlot,
  generateStillsInputSchema,
  generateVideoInputSchema,
  mediaApprovalSchema,
  mediaExtension,
  productMediaKey,
  productMediaRoleSchema,
  siteMediaSlotSchema,
  SITE_MEDIA_SLOT_LIMITS,
} from "@foundry/domain";
import { buildMediaPrompt } from "@foundry/media";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireProjectCapability, requireWorkspaceCapability } from "../access";
import { getMediaGenerator, isMediaImageConfigured, isMediaVideoConfigured } from "../media";
import { getObjectStorage } from "../storage";
import { loadProductContext, toMediaPromptContext } from "../product-context";

/** In-app preview URL. Auth-gated by the project file route. */
function mediaUrl(key: string): string {
  return `/api/files/${key}`;
}

type MediaWithUrls = ProductMedia & { url: string; posterUrl: string | null };

function withUrls(media: ProductMedia): MediaWithUrls {
  return {
    ...media,
    url: mediaUrl(media.storageKey),
    posterUrl: media.posterStorageKey ? mediaUrl(media.posterStorageKey) : null,
  };
}

/** Loads media plus the workspace membership check for its project. */
async function requireMedia(
  userId: string,
  mediaId: string,
  capability: "site.edit" | "site.publish",
) {
  const media = await prisma.productMedia.findUnique({ where: { id: mediaId } });
  if (!media) throw new TRPCError({ code: "NOT_FOUND", message: "Media not found" });
  await requireWorkspaceCapability(userId, media.workspaceId, capability, media.projectId);
  return media;
}

export const mediaRouter = router({
  /** Whether generation is real or SIMULATED, so the UI can label it up front. */
  status: protectedProcedure.query(() => ({
    imageConfigured: isMediaImageConfigured(),
    videoConfigured: isMediaVideoConfigured(),
  })),

  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      const media = await prisma.productMedia.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return media.map(withUrls);
    }),

  jobs: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      return prisma.mediaJob.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
    }),

  /**
   * Generates one still per requested role. Each role gets its own grounded
   * prompt so a batch produces a usable set (hero, detail, lifestyle) rather
   * than six variations of the same framing.
   */
  generateStills: protectedProcedure
    .input(generateStillsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(ctx.user.id, input.projectId, "site.edit");
      const { context, releaseId } = await loadProductContext(input.projectId);
      const promptContext = toMediaPromptContext(context);

      const job = await prisma.mediaJob.create({
        data: {
          workspaceId: project.workspaceId,
          projectId: project.id,
          releaseId: input.releaseId ?? releaseId,
          type: "GENERATE_STILLS",
          status: "RUNNING",
          input: input as unknown as Prisma.InputJsonValue,
          createdById: ctx.user.id,
          startedAt: new Date(),
        },
      });
      await recordAudit({
        type: "MediaJobStarted",
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: ctx.user.id,
        payload: { jobId: job.id, type: job.type, roles: input.roles },
      });

      const generator = getMediaGenerator();
      const storage = getObjectStorage();
      const created: ProductMedia[] = [];
      const failures: string[] = [];

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
          projectId: project.id,
          batchId: job.id,
          filename: `${index}-${role.toLowerCase()}.${mediaExtension(still.mimeType)}`,
        });
        const stored = await storage.put(key, still.bytes, still.mimeType);

        const media = await prisma.productMedia.create({
          data: {
            workspaceId: project.workspaceId,
            projectId: project.id,
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
            jobId: job.id,
            createdById: ctx.user.id,
          },
        });
        created.push(media);
        await recordAudit({
          type: "ProductMediaCreated",
          workspaceId: project.workspaceId,
          projectId: project.id,
          actorId: ctx.user.id,
          payload: { mediaId: media.id, role, simulated: media.simulated, jobId: job.id },
        });
      }

      const status = created.length > 0 ? "SUCCEEDED" : "FAILED";
      await prisma.mediaJob.update({
        where: { id: job.id },
        data: {
          status,
          error: failures.length ? failures.join("; ") : null,
          finishedAt: new Date(),
        },
      });
      await recordAudit({
        type: "MediaJobFinished",
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: ctx.user.id,
        payload: { jobId: job.id, status, created: created.length, failures },
      });

      if (created.length === 0) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: failures.join("; ") || "Image generation failed",
        });
      }
      return {
        jobId: job.id,
        media: created.map(withUrls),
        partialFailures: failures,
      };
    }),

  /**
   * Generates a short product video, optionally seeded by an existing still so
   * the footage matches an already-approved render.
   */
  generateVideo: protectedProcedure
    .input(generateVideoInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(ctx.user.id, input.projectId, "site.edit");
      const { context, releaseId } = await loadProductContext(input.projectId);

      let seedImage: { bytes: Uint8Array; mimeType: string } | undefined;
      let seedKey: string | null = null;
      if (input.seedMediaId) {
        const seed = await prisma.productMedia.findUnique({ where: { id: input.seedMediaId } });
        if (!seed || seed.projectId !== project.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Seed image not found" });
        }
        if (seed.kind !== "STILL") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Seed media must be a still" });
        }
        const object = await getObjectStorage().get(seed.storageKey);
        if (!object) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Seed image bytes are missing" });
        }
        seedImage = { bytes: object.body, mimeType: object.contentType };
        seedKey = seed.storageKey;
      }

      const job = await prisma.mediaJob.create({
        data: {
          workspaceId: project.workspaceId,
          projectId: project.id,
          releaseId: input.releaseId ?? releaseId,
          type: "GENERATE_VIDEO",
          status: "RUNNING",
          input: input as unknown as Prisma.InputJsonValue,
          createdById: ctx.user.id,
          startedAt: new Date(),
        },
      });
      await recordAudit({
        type: "MediaJobStarted",
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: ctx.user.id,
        payload: { jobId: job.id, type: job.type, durationSec: input.durationSec },
      });

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

      if (!result.ok) {
        await prisma.mediaJob.update({
          where: { id: job.id },
          data: { status: "FAILED", error: result.error, finishedAt: new Date() },
        });
        await recordAudit({
          type: "MediaJobFinished",
          workspaceId: project.workspaceId,
          projectId: project.id,
          actorId: ctx.user.id,
          payload: { jobId: job.id, status: "FAILED", error: result.error },
        });
        throw new TRPCError({ code: "BAD_GATEWAY", message: result.error });
      }

      const video = result.data;
      const key = productMediaKey({
        projectId: project.id,
        batchId: job.id,
        filename: `video.${mediaExtension(video.mimeType)}`,
      });
      const stored = await getObjectStorage().put(key, video.bytes, video.mimeType);

      let posterKey = seedKey;
      if (!posterKey && video.poster) {
        posterKey = productMediaKey({
          projectId: project.id,
          batchId: job.id,
          filename: `poster.${mediaExtension(video.poster.mimeType)}`,
        });
        await getObjectStorage().put(posterKey, video.poster.bytes, video.poster.mimeType);
      }

      const media = await prisma.productMedia.create({
        data: {
          workspaceId: project.workspaceId,
          projectId: project.id,
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
          jobId: job.id,
          createdById: ctx.user.id,
        },
      });

      await prisma.mediaJob.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", finishedAt: new Date() },
      });
      await recordAudit({
        type: "ProductMediaCreated",
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: ctx.user.id,
        payload: { mediaId: media.id, kind: "VIDEO", simulated: media.simulated, jobId: job.id },
      });
      return { jobId: job.id, media: withUrls(media) };
    }),

  /**
   * Promotes an existing project capture (CAD/PCB screenshot already in object
   * storage) into the media library, so real engineering renders can be reused
   * for marketing without regenerating them.
   */
  promoteCapture: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        storageKey: z.string().min(1),
        role: productMediaRoleSchema.default("GALLERY"),
        source: z.enum(["CAD_CAPTURE", "PCB_CAPTURE"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(ctx.user.id, input.projectId, "site.edit");
      if (!input.storageKey.startsWith(`projects/${project.id}/`)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Capture does not belong to this project",
        });
      }

      const storage = getObjectStorage();
      const object = await storage.get(input.storageKey);
      if (!object) throw new TRPCError({ code: "NOT_FOUND", message: "Capture not found" });

      const { releaseId } = await loadProductContext(project.id);
      const batchId = `promoted-${Date.now()}`;
      const key = productMediaKey({
        projectId: project.id,
        batchId,
        filename: `capture.${mediaExtension(object.contentType)}`,
      });
      const stored = await storage.put(key, object.body, object.contentType);

      const media = await prisma.productMedia.create({
        data: {
          workspaceId: project.workspaceId,
          projectId: project.id,
          releaseId,
          kind: "STILL",
          role: input.role,
          source: input.source,
          storageKey: key,
          mimeType: object.contentType,
          sha256: stored.sha256,
          sizeBytes: stored.sizeBytes,
          generator: "capture",
          createdById: ctx.user.id,
        },
      });
      await recordAudit({
        type: "ProductMediaCreated",
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: ctx.user.id,
        payload: { mediaId: media.id, source: input.source, from: input.storageKey },
      });
      return withUrls(media);
    }),

  /**
   * Marketing sign-off. Deliberately gated on `site.publish` (admin/owner):
   * approval is what lets an asset reach a storefront. SIMULATED assets can
   * never be approved (AGENTS.md rule 3).
   */
  setApproval: protectedProcedure
    .input(z.object({ mediaId: z.string(), approval: mediaApprovalSchema }))
    .mutation(async ({ ctx, input }) => {
      const media = await requireMedia(ctx.user.id, input.mediaId, "site.publish");
      if (input.approval === "APPROVED_FOR_MARKETING" && media.simulated) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This asset is SIMULATED and cannot be approved for marketing. Configure OPENAI_API_KEY to generate real renders.",
        });
      }

      const updated = await prisma.productMedia.update({
        where: { id: media.id },
        data: { approval: input.approval },
      });
      await recordAudit({
        type: "ProductMediaApprovalChanged",
        workspaceId: media.workspaceId,
        projectId: media.projectId,
        actorId: ctx.user.id,
        payload: { mediaId: media.id, from: media.approval, to: input.approval },
      });
      return withUrls(updated);
    }),

  remove: protectedProcedure
    .input(z.object({ mediaId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const media = await requireMedia(ctx.user.id, input.mediaId, "site.edit");

      await prisma.productMedia.delete({ where: { id: media.id } });
      // Bytes go last: a failed delete leaves an orphan object, not a broken row.
      const storage = getObjectStorage();
      await storage.delete(media.storageKey).catch(() => undefined);
      if (media.posterStorageKey) {
        await storage.delete(media.posterStorageKey).catch(() => undefined);
      }

      await recordAudit({
        type: "ProductMediaDeleted",
        workspaceId: media.workspaceId,
        projectId: media.projectId,
        actorId: ctx.user.id,
        payload: { mediaId: media.id, storageKey: media.storageKey },
      });
      return { id: media.id };
    }),

  /** Media currently used by a site, in render order. */
  siteMedia: protectedProcedure
    .input(z.object({ siteId: z.string() }))
    .query(async ({ ctx, input }) => {
      const site = await prisma.site.findUnique({ where: { id: input.siteId } });
      if (!site) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(ctx.user.id, site.workspaceId, "project.read");

      const attachments = await prisma.siteMediaAttachment.findMany({
        where: { siteId: site.id },
        include: { media: true },
        orderBy: [{ slot: "asc" }, { sortOrder: "asc" }],
      });
      return attachments.map((attachment) => ({
        ...attachment,
        media: withUrls(attachment.media),
      }));
    }),

  attach: protectedProcedure
    .input(
      z.object({
        siteId: z.string(),
        mediaId: z.string(),
        slot: siteMediaSlotSchema,
        altText: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const site = await prisma.site.findUnique({ where: { id: input.siteId } });
      if (!site) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(
        ctx.user.id,
        site.workspaceId,
        "site.edit",
        site.projectId ?? undefined,
      );

      const media = await prisma.productMedia.findUnique({ where: { id: input.mediaId } });
      if (!media) throw new TRPCError({ code: "NOT_FOUND", message: "Media not found" });
      if (media.workspaceId !== site.workspaceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Media belongs to a different workspace",
        });
      }
      if (media.approval !== "APPROVED_FOR_MARKETING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Approve this asset for marketing before using it on a site",
        });
      }

      const existing = await prisma.siteMediaAttachment.findMany({
        where: { siteId: site.id },
        include: { media: { select: { kind: true } } },
      });
      const check = canAttachToSlot({ slot: input.slot, kind: media.kind, existing });
      if (!check.ok) throw new TRPCError({ code: "BAD_REQUEST", message: check.message });

      const attachment = await prisma.siteMediaAttachment.create({
        data: {
          siteId: site.id,
          mediaId: media.id,
          slot: input.slot,
          altText: input.altText ?? null,
          sortOrder: existing.filter((item) => item.slot === input.slot).length,
        },
      });
      await recordAudit({
        type: "SiteMediaAttached",
        workspaceId: site.workspaceId,
        projectId: site.projectId,
        actorId: ctx.user.id,
        payload: { siteId: site.id, mediaId: media.id, slot: input.slot },
      });
      return attachment;
    }),

  detach: protectedProcedure
    .input(z.object({ attachmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const attachment = await prisma.siteMediaAttachment.findUnique({
        where: { id: input.attachmentId },
        include: { site: true },
      });
      if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(
        ctx.user.id,
        attachment.site.workspaceId,
        "site.edit",
        attachment.site.projectId ?? undefined,
      );

      await prisma.siteMediaAttachment.delete({ where: { id: attachment.id } });
      await recordAudit({
        type: "SiteMediaDetached",
        workspaceId: attachment.site.workspaceId,
        projectId: attachment.site.projectId,
        actorId: ctx.user.id,
        payload: {
          siteId: attachment.siteId,
          mediaId: attachment.mediaId,
          slot: attachment.slot,
        },
      });
      return { id: attachment.id };
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        siteId: z.string(),
        slot: siteMediaSlotSchema,
        /** Attachment ids in the order they should render. */
        attachmentIds: z.array(z.string()).min(1).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const site = await prisma.site.findUnique({ where: { id: input.siteId } });
      if (!site) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(
        ctx.user.id,
        site.workspaceId,
        "site.edit",
        site.projectId ?? undefined,
      );
      if (input.attachmentIds.length > SITE_MEDIA_SLOT_LIMITS[input.slot]) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Too many items for ${input.slot}` });
      }

      const attachments = await prisma.siteMediaAttachment.findMany({
        where: { siteId: site.id, slot: input.slot },
        select: { id: true },
      });
      const known = new Set(attachments.map((item) => item.id));
      if (input.attachmentIds.some((id) => !known.has(id))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown attachment for this slot" });
      }

      await prisma.$transaction(
        input.attachmentIds.map((id, index) =>
          prisma.siteMediaAttachment.update({ where: { id }, data: { sortOrder: index } }),
        ),
      );
      await recordAudit({
        type: "SiteMediaReordered",
        workspaceId: site.workspaceId,
        projectId: site.projectId,
        actorId: ctx.user.id,
        payload: { siteId: site.id, slot: input.slot, order: input.attachmentIds },
      });
      return { ok: true };
    }),
});
