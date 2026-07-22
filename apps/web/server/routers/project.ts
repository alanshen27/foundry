import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { slugify, STAGES } from "@foundry/domain";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireWorkspaceCapability } from "../access";

export const projectRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        name: z.string().min(1).max(80),
        description: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Any member with research.edit can start a project (MEMBER default).
      await requireWorkspaceCapability(ctx.user.id, input.workspaceId, "research.edit");

      const base = slugify(input.name);
      let slug = base;
      for (
        let i = 2;
        await prisma.project.findUnique({
          where: { workspaceId_slug: { workspaceId: input.workspaceId, slug } },
        });
        i++
      ) {
        slug = `${base}-${i}`;
      }

      const project = await prisma.project.create({
        data: {
          workspaceId: input.workspaceId,
          name: input.name,
          slug,
          description: input.description,
          createdById: ctx.user.id,
        },
      });
      const branch = await prisma.projectBranch.create({
        data: { projectId: project.id, name: "main", isDefault: true, createdById: ctx.user.id },
      });
      await prisma.project.update({
        where: { id: project.id },
        data: { activeBranchId: branch.id },
      });
      await prisma.stageState.createMany({
        data: STAGES.map((stage) => ({ projectId: project.id, branchId: branch.id, stage })),
      });

      await recordAudit({
        type: "ProjectCreated",
        workspaceId: input.workspaceId,
        projectId: project.id,
        branchId: branch.id,
        actorId: ctx.user.id,
        payload: { name: project.name, slug: project.slug },
      });
      await recordAudit({
        type: "ProjectBranchCreated",
        workspaceId: input.workspaceId,
        projectId: project.id,
        branchId: branch.id,
        actorId: ctx.user.id,
        payload: { name: "main", isDefault: true },
      });
      return { ...project, slug };
    }),

  createBranch: protectedProcedure
    .input(z.object({ projectId: z.string(), name: z.string().min(1).max(60) }))
    .mutation(async ({ ctx, input }) => {
      const project = await prisma.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(
        ctx.user.id,
        project.workspaceId,
        "research.edit",
        project.id,
      );
      const branch = await prisma.projectBranch.create({
        data: { projectId: project.id, name: slugify(input.name), createdById: ctx.user.id },
      });
      await prisma.stageState.createMany({
        data: (["IDEATE", "ENGINEER", "VERIFY", "LAUNCH"] as const).map((stage) => ({
          projectId: project.id,
          branchId: branch.id,
          stage,
        })),
      });
      await recordAudit({
        type: "ProjectBranchCreated",
        workspaceId: project.workspaceId,
        projectId: project.id,
        branchId: branch.id,
        actorId: ctx.user.id,
        payload: { name: branch.name },
      });
      return branch;
    }),
});
