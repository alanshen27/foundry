import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { canTransitionStage, STAGES, type StageStatus } from "@foundry/domain";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireWorkspaceCapability } from "../access";

export const stageRouter = router({
  /**
   * Phase 0's only stage mutation: mark a stage DRAFT the first time a
   * user opens it. Real stage gates (approvals, staleness) come later.
   */
  open: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string(), stage: z.enum(STAGES) }))
    .mutation(async ({ ctx, input }) => {
      const project = await prisma.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(ctx.user.id, project.workspaceId, "project.read");

      const stageState = await prisma.stageState.findUnique({
        where: {
          projectId_branchId_stage: {
            projectId: input.projectId,
            branchId: input.branchId,
            stage: input.stage,
          },
        },
      });
      if (!stageState) throw new TRPCError({ code: "NOT_FOUND" });
      // Only the first visit (NOT_STARTED) flips to DRAFT; never regress an
      // in-progress or approved stage back to DRAFT.
      if (stageState.status !== "NOT_STARTED") {
        return stageState;
      }
      if (!canTransitionStage(stageState.status as StageStatus, "DRAFT")) {
        return stageState;
      }
      const updated = await prisma.stageState.update({
        where: { id: stageState.id },
        data: { status: "DRAFT" },
      });
      await recordAudit({
        type: "StageOpened",
        workspaceId: project.workspaceId,
        projectId: project.id,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { stage: input.stage, from: stageState.status, to: "DRAFT" },
      });
      return updated;
    }),
});
