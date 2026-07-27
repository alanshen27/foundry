import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import type { Capability } from "@foundry/domain";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireProjectCapability } from "../access";
import { ensureStageStarted, markDownstreamStale } from "../stage-state";

const discipline = z.enum(["ELECTRONICS", "MECHANICAL", "SOFTWARE", "DESIGN"]);

function disciplineCapability(d: z.infer<typeof discipline>): Capability {
  switch (d) {
    case "ELECTRONICS":
      return "electronics.edit";
    case "MECHANICAL":
      return "mechanical.edit";
    case "SOFTWARE":
      return "software.edit";
    case "DESIGN":
      return "site.edit";
  }
}

export const engineerRouter = router({
  listComponents: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      return prisma.component.findMany({
        where: { projectId: input.projectId, branchId: input.branchId },
        orderBy: [{ discipline: "asc" }, { createdAt: "asc" }],
      });
    }),

  createComponent: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        discipline: discipline.default("ELECTRONICS"),
        refDes: z.string().max(40).nullish(),
        name: z.string().min(1).max(200),
        manufacturer: z.string().max(120).nullish(),
        partNumber: z.string().max(120).nullish(),
        quantity: z.number().int().positive().default(1),
        unitCostCents: z.number().int().nonnegative().nullish(),
        sourceUrl: z.string().url().max(500).nullish(),
        imageUrl: z.string().url().max(2000).nullish(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        disciplineCapability(input.discipline),
      );
      const { projectId, branchId, ...fields } = input;
      const component = await prisma.component.create({
        data: { projectId, branchId, createdById: ctx.user.id, ...fields },
      });
      await ensureStageStarted({
        workspaceId: project.workspaceId,
        projectId,
        branchId,
        stage: "ENGINEER",
        actorId: ctx.user.id,
      });
      await recordAudit({
        type: "ComponentCreated",
        workspaceId: project.workspaceId,
        projectId,
        branchId,
        actorId: ctx.user.id,
        payload: { componentId: component.id, name: component.name },
      });
      await markDownstreamStale({
        workspaceId: project.workspaceId,
        projectId,
        branchId,
        changedStage: "ENGINEER",
        actorId: ctx.user.id,
      });
      return component;
    }),

  updateComponent: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        discipline: discipline.optional(),
        refDes: z.string().max(40).nullish(),
        name: z.string().min(1).max(200).optional(),
        manufacturer: z.string().max(120).nullish(),
        partNumber: z.string().max(120).nullish(),
        quantity: z.number().int().positive().optional(),
        unitCostCents: z.number().int().nonnegative().nullish(),
        sourceUrl: z.string().url().max(500).nullish(),
        imageUrl: z.string().url().max(2000).nullish(),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.component.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        existing.projectId,
        disciplineCapability((input.discipline ?? existing.discipline) as z.infer<typeof discipline>),
      );
      const { id, ...fields } = input;
      const component = await prisma.component.update({ where: { id }, data: fields });
      await recordAudit({
        type: "ComponentUpdated",
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        actorId: ctx.user.id,
        payload: { componentId: id },
      });
      await markDownstreamStale({
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        changedStage: "ENGINEER",
        actorId: ctx.user.id,
      });
      return component;
    }),

  deleteComponent: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.component.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        existing.projectId,
        disciplineCapability(existing.discipline as z.infer<typeof discipline>),
      );
      await prisma.component.delete({ where: { id: input.id } });
      await recordAudit({
        type: "ComponentDeleted",
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        actorId: ctx.user.id,
        payload: { componentId: input.id },
      });
      await markDownstreamStale({
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        changedStage: "ENGINEER",
        actorId: ctx.user.id,
      });
      return { id: input.id };
    }),

  listRepos: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      return prisma.repoLink.findMany({
        where: { projectId: input.projectId, branchId: input.branchId },
        orderBy: { createdAt: "asc" },
      });
    }),

  createRepo: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        role: z.string().min(1).max(80),
        url: z.string().url().max(500),
        notes: z.string().max(1000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "github.connect",
      );
      const { projectId, branchId, ...fields } = input;
      const repo = await prisma.repoLink.create({
        data: { projectId, branchId, createdById: ctx.user.id, ...fields },
      });
      await ensureStageStarted({
        workspaceId: project.workspaceId,
        projectId,
        branchId,
        stage: "ENGINEER",
        actorId: ctx.user.id,
      });
      await recordAudit({
        type: "RepoLinkCreated",
        workspaceId: project.workspaceId,
        projectId,
        branchId,
        actorId: ctx.user.id,
        payload: { repoLinkId: repo.id, url: repo.url },
      });
      return repo;
    }),

  deleteRepo: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.repoLink.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        existing.projectId,
        "github.connect",
      );
      await prisma.repoLink.delete({ where: { id: input.id } });
      await recordAudit({
        type: "RepoLinkDeleted",
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        actorId: ctx.user.id,
        payload: { repoLinkId: input.id },
      });
      return { id: input.id };
    }),
});
