import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { requireProjectCapability } from "../access";
import { ensureStageStarted, markDownstreamStale, touchProject } from "../stage-state";
import { writeCodeWithCollaboration, deleteCodeWithCollaboration } from "../collab-write";
import { recordAudit } from "../audit";

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

  /**
   * Every code file in a project, across all its repos. listFiles is scoped to
   * one repo, which is right for the file tree but wrong for anything that
   * needs to offer a choice across repos — the simulator picking which sketch
   * to run would otherwise need one query per repo.
   */
  listProjectFiles: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      const repos = await prisma.repoLink.findMany({
        where: { projectId: input.projectId, branchId: input.branchId },
        select: { id: true, role: true },
      });
      if (repos.length === 0) return [];
      const files = await prisma.codeFile.findMany({
        where: { repoId: { in: repos.map((r) => r.id) } },
        select: { id: true, path: true, repoId: true, updatedAt: true },
        orderBy: { path: "asc" },
      });
      const roleOf = new Map(repos.map((r) => [r.id, r.role]));
      return files.map((f) => ({ ...f, repoRole: roleOf.get(f.repoId) ?? "" }));
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
      const file = await writeCodeWithCollaboration({
        projectId: repo.projectId,
        branchId: repo.branchId,
        repoId: input.repoId,
        path: input.path,
        content: input.content,
        userId: ctx.user.id,
        human: true,
        createOnly: true,
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
    .input(
      z.object({
        id: z.string(),
        content: z.string().max(400_000),
        baseContent: z.string().max(400_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const file = await prisma.codeFile.findUnique({ where: { id: input.id } });
      if (!file) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        file.projectId,
        "software.edit",
      );
      const updated = await writeCodeWithCollaboration({
        projectId: file.projectId,
        branchId: file.branchId,
        repoId: file.repoId,
        path: file.path,
        content: input.content,
        baseContent: input.baseContent ?? file.content,
        userId: ctx.user.id,
        human: true,
      });
      await recordAudit({
        type: "CollaborationDocumentUpdated",
        workspaceId: project.workspaceId,
        projectId: file.projectId,
        branchId: file.branchId,
        actorId: ctx.user.id,
        payload: { fileId: file.id, source: "code.saveFile" },
      });
      await touchProject({
        workspaceId: project.workspaceId,
        projectId: file.projectId,
        branchId: file.branchId,
        stage: "ENGINEER",
        actorId: ctx.user.id,
      });
      return { id: updated.id, updatedAt: updated.updatedAt };
    }),

  deleteFile: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const file = await prisma.codeFile.findUnique({ where: { id: input.id } });
      if (!file) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        file.projectId,
        "software.edit",
      );
      await deleteCodeWithCollaboration({
        fileId: input.id,
        projectId: file.projectId,
        branchId: file.branchId,
        userId: ctx.user.id,
        human: true,
      });
      await markDownstreamStale({
        workspaceId: project.workspaceId,
        projectId: file.projectId,
        branchId: file.branchId,
        changedStage: "ENGINEER",
        actorId: ctx.user.id,
      });
      await recordAudit({
        type: "CollaborationDocumentUpdated",
        workspaceId: project.workspaceId,
        projectId: file.projectId,
        branchId: file.branchId,
        actorId: ctx.user.id,
        payload: { fileId: file.id, deleted: true },
      });
      return { id: input.id };
    }),
});
