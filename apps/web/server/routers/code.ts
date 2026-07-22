import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { requireProjectCapability } from "../access";
import { ensureStageStarted, markDownstreamStale } from "../stage-state";

const pathSchema = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[\w\-./+]+$/, "Invalid path")
  .refine((p) => !p.includes("..") && !p.startsWith("/"), "Invalid path");

export const codeRouter = router({
  listFiles: protectedProcedure
    .input(z.object({ repoId: z.string() }))
    .query(async ({ ctx, input }) => {
      const repo = await prisma.repoLink.findUnique({ where: { id: input.repoId } });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND" });
      await requireProjectCapability(ctx.user.id, repo.projectId, "project.read");
      return prisma.codeFile.findMany({
        where: { repoId: input.repoId },
        select: { id: true, path: true, updatedAt: true },
        orderBy: { path: "asc" },
      });
    }),

  getFile: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const file = await prisma.codeFile.findUnique({ where: { id: input.id } });
    if (!file) throw new TRPCError({ code: "NOT_FOUND" });
    await requireProjectCapability(ctx.user.id, file.projectId, "project.read");
    return file;
  }),

  createFile: protectedProcedure
    .input(
      z.object({
        repoId: z.string(),
        path: pathSchema,
        content: z.string().max(400_000).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const repo = await prisma.repoLink.findUnique({ where: { id: input.repoId } });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        repo.projectId,
        "software.edit",
      );
      const existing = await prisma.codeFile.findUnique({
        where: { repoId_path: { repoId: input.repoId, path: input.path } },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A file with this path already exists" });
      }
      const file = await prisma.codeFile.create({
        data: {
          projectId: repo.projectId,
          branchId: repo.branchId,
          repoId: input.repoId,
          path: input.path,
          content: input.content,
          updatedById: ctx.user.id,
        },
      });
      await ensureStageStarted({
        workspaceId: project.workspaceId,
        projectId: repo.projectId,
        branchId: repo.branchId,
        stage: "ENGINEER",
        actorId: ctx.user.id,
      });
      return file;
    }),

  saveFile: protectedProcedure
    .input(z.object({ id: z.string(), content: z.string().max(400_000) }))
    .mutation(async ({ ctx, input }) => {
      const file = await prisma.codeFile.findUnique({ where: { id: input.id } });
      if (!file) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        file.projectId,
        "software.edit",
      );
      const updated = await prisma.codeFile.update({
        where: { id: input.id },
        data: { content: input.content, updatedById: ctx.user.id },
      });
      await markDownstreamStale({
        workspaceId: project.workspaceId,
        projectId: file.projectId,
        branchId: file.branchId,
        changedStage: "ENGINEER",
        actorId: ctx.user.id,
      });
      return { id: updated.id, updatedAt: updated.updatedAt };
    }),

  deleteFile: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const file = await prisma.codeFile.findUnique({ where: { id: input.id } });
      if (!file) throw new TRPCError({ code: "NOT_FOUND" });
      await requireProjectCapability(ctx.user.id, file.projectId, "software.edit");
      await prisma.codeFile.delete({ where: { id: input.id } });
      return { id: input.id };
    }),
});
