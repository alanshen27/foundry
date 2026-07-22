import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireWorkspaceCapability } from "../access";
import { getObjectStorage } from "../storage";

/**
 * Thin artifact-upload path proving the ObjectStoragePort abstraction.
 * Uploaded artifacts are always created UNVERIFIED (PRD instruction 6).
 */
export const artifactRouter = router({
  upload: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        name: z.string().min(1).max(120),
        mimeType: z.string().min(1),
        // Base64 body; Phase 0 caps uploads at ~2 MB. Resumable transfers
        // for large binaries arrive with the artifact service phase.
        contentBase64: z.string().max(3_000_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await prisma.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(
        ctx.user.id,
        project.workspaceId,
        "research.edit",
        project.id,
      );

      const body = Buffer.from(input.contentBase64, "base64");
      const key = `${project.workspaceId}/${project.id}/${randomUUID()}-${input.name}`;
      const stored = await getObjectStorage().put(key, body, input.mimeType);

      const artifact = await prisma.artifact.create({
        data: {
          projectId: project.id,
          branchId: input.branchId,
          kind: "upload",
          name: input.name,
          storageKey: stored.key,
          sha256: stored.sha256,
          mimeType: input.mimeType,
          sizeBytes: stored.sizeBytes,
          verificationState: "UNVERIFIED",
          createdById: ctx.user.id,
        },
      });
      await recordAudit({
        type: "ArtifactUploadRequested",
        workspaceId: project.workspaceId,
        projectId: project.id,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: {
          artifactId: artifact.id,
          sha256: stored.sha256,
          backend: stored.backend,
        },
      });
      return artifact;
    }),
});
