import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireProjectCapability } from "../access";
import { ensureStageStarted, markDownstreamStale } from "../stage-state";

const requirementType = z.enum([
  "FUNCTIONAL",
  "ELECTRICAL",
  "MECHANICAL",
  "SOFTWARE",
  "VISUAL",
  "MANUFACTURING",
  "COST",
  "COMPLIANCE",
  "UX",
]);
const requirementPriority = z.enum(["MUST", "SHOULD", "MAY"]);
const requirementStatus = z.enum(["PROPOSED", "ACCEPTED", "REJECTED"]);

const briefInput = z.object({
  projectId: z.string(),
  branchId: z.string(),
  prompt: z.string().max(4000).nullish(),
  intendedUse: z.string().max(2000).nullish(),
  environment: z.string().max(2000).nullish(),
  targetAudience: z.string().max(2000).nullish(),
  budgetCents: z.number().int().nonnegative().nullish(),
  currency: z.string().length(3).optional(),
  dimensions: z.string().max(1000).nullish(),
  performanceTargets: z.string().max(2000).nullish(),
  manufacturingNotes: z.string().max(2000).nullish(),
});

export const ideateRouter = router({
  getBrief: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      return prisma.projectBrief.findUnique({
        where: {
          projectId_branchId: { projectId: input.projectId, branchId: input.branchId },
        },
      });
    }),

  saveBrief: protectedProcedure.input(briefInput).mutation(async ({ ctx, input }) => {
    const { project } = await requireProjectCapability(ctx.user.id, input.projectId, "ideate.edit");
    const { projectId, branchId, currency, ...fields } = input;
    const data = { ...fields, currency: currency ?? "USD" };
    const brief = await prisma.projectBrief.upsert({
      where: { projectId_branchId: { projectId, branchId } },
      create: { projectId, branchId, updatedById: ctx.user.id, ...data },
      update: { updatedById: ctx.user.id, ...data },
    });
    await ensureStageStarted({
      workspaceId: project.workspaceId,
      projectId,
      branchId,
      stage: "IDEATE",
      actorId: ctx.user.id,
    });
    await recordAudit({
      type: "BriefUpdated",
      workspaceId: project.workspaceId,
      projectId,
      branchId,
      actorId: ctx.user.id,
      payload: { briefId: brief.id },
    });
    await markDownstreamStale({
      workspaceId: project.workspaceId,
      projectId,
      branchId,
      changedStage: "IDEATE",
      actorId: ctx.user.id,
    });
    return brief;
  }),

  listRequirements: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      return prisma.requirement.findMany({
        where: { projectId: input.projectId, branchId: input.branchId },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      });
    }),

  createRequirement: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        type: requirementType.default("FUNCTIONAL"),
        priority: requirementPriority.default("SHOULD"),
        minValue: z.number().nullish(),
        maxValue: z.number().nullish(),
        unit: z.string().max(40).nullish(),
        rationale: z.string().max(2000).nullish(),
        verificationMethod: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "ideate.edit",
      );
      const { projectId, branchId, ...fields } = input;
      const requirement = await prisma.requirement.create({
        data: { projectId, branchId, createdById: ctx.user.id, ...fields },
      });
      await ensureStageStarted({
        workspaceId: project.workspaceId,
        projectId,
        branchId,
        stage: "IDEATE",
        actorId: ctx.user.id,
      });
      await recordAudit({
        type: "RequirementCreated",
        workspaceId: project.workspaceId,
        projectId,
        branchId,
        actorId: ctx.user.id,
        payload: { requirementId: requirement.id, title: requirement.title },
      });
      await markDownstreamStale({
        workspaceId: project.workspaceId,
        projectId,
        branchId,
        changedStage: "IDEATE",
        actorId: ctx.user.id,
      });
      return requirement;
    }),

  updateRequirement: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullish(),
        type: requirementType.optional(),
        priority: requirementPriority.optional(),
        status: requirementStatus.optional(),
        minValue: z.number().nullish(),
        maxValue: z.number().nullish(),
        unit: z.string().max(40).nullish(),
        rationale: z.string().max(2000).nullish(),
        verificationMethod: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.requirement.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        existing.projectId,
        "ideate.edit",
      );
      const { id, ...fields } = input;
      const requirement = await prisma.requirement.update({ where: { id }, data: fields });
      await recordAudit({
        type: "RequirementUpdated",
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        actorId: ctx.user.id,
        payload: { requirementId: id },
      });
      await markDownstreamStale({
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        changedStage: "IDEATE",
        actorId: ctx.user.id,
      });
      return requirement;
    }),

  deleteRequirement: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.requirement.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        existing.projectId,
        "ideate.edit",
      );
      await prisma.requirement.delete({ where: { id: input.id } });
      await recordAudit({
        type: "RequirementDeleted",
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        actorId: ctx.user.id,
        payload: { requirementId: input.id },
      });
      await markDownstreamStale({
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        changedStage: "IDEATE",
        actorId: ctx.user.id,
      });
      return { id: input.id };
    }),
});
