import { z } from "zod";
import { prisma, type Prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { requireProjectCapability } from "../access";
import { ensureStageStarted, markDownstreamStale } from "../stage-state";

const kind = z.enum(["CIRCUIT", "MODEL3D", "DESIGN"]);

const KIND_CAPABILITY = {
  CIRCUIT: "electronics.edit",
  MODEL3D: "mechanical.edit",
  DESIGN: "site.edit",
} as const;

export const designRouter = router({
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
      const doc = await prisma.designDoc.upsert({
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
      return doc;
    }),
});
