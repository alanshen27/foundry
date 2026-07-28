import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma, type Prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { requireProjectCapability } from "../access";
import { ensureStageStarted, markDownstreamStale } from "../stage-state";
import { AiEditLockConflict, getActiveAiEditLock, withAiEditLockGuard } from "../ai-edit-lock";
import { recordAudit } from "../audit";

const kind = z.enum(["CIRCUIT", "PCB", "MODEL3D", "DESIGN"]);

const KIND_CAPABILITY = {
  CIRCUIT: "electronics.edit",
  PCB: "electronics.edit",
  MODEL3D: "mechanical.edit",
  DESIGN: "site.edit",
} as const;

export const designRouter = router({
  aiEditLock: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      const lock = await getActiveAiEditLock(input.projectId, input.branchId);
      if (!lock) return null;
      const owner = await prisma.user.findUnique({
        where: { id: lock.actorId },
        select: { name: true },
      });
      return {
        runId: lock.id,
        status: lock.status,
        actorId: lock.actorId,
        actorName: owner?.name ?? "AI collaborator",
        acquiredAt: lock.startedAt ?? lock.createdAt,
      };
    }),

  get: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string(), kind }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      return prisma.designDoc.findUnique({
        where: {
          projectId_branchId_kind: {
            projectId: input.projectId,
            branchId: input.branchId,
            kind: input.kind,
          },
        },
      });
    }),

  save: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        kind,
        data: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        KIND_CAPABILITY[input.kind],
      );
      const data = (input.data ?? {}) as Prisma.InputJsonValue;
      const write = (db: Pick<Prisma.TransactionClient, "designDoc">) =>
        db.designDoc.upsert({
          where: {
            projectId_branchId_kind: {
              projectId: input.projectId,
              branchId: input.branchId,
              kind: input.kind,
            },
          },
          create: {
            projectId: input.projectId,
            branchId: input.branchId,
            kind: input.kind,
            data,
            updatedById: ctx.user.id,
          },
          update: { data, updatedById: ctx.user.id },
        });

      let doc;
      try {
        // Mechanical CAD is the shared workspace being leased. Other design
        // surfaces keep their existing independent collaboration behavior.
        doc =
          input.kind === "MODEL3D"
            ? await withAiEditLockGuard(input.projectId, input.branchId, write)
            : await write(prisma);
      } catch (error) {
        if (error instanceof AiEditLockConflict) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "CAD workspace locked while an AI agent is editing. Your changes were not saved.",
          });
        }
        throw error;
      }
      await ensureStageStarted({
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        stage: "ENGINEER",
        actorId: ctx.user.id,
      });
      await markDownstreamStale({
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        changedStage: "ENGINEER",
        actorId: ctx.user.id,
      });
      await recordAudit({
        type: "DesignDocUpdated",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { kind: input.kind, designDocId: doc.id },
      });
      return doc;
    }),
});
