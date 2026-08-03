import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { requireProjectCapability } from "../access";
import { recordAudit } from "../audit";

/**
 * Comments pinned to a spot on a visual canvas. One model serves every
 * surface — PCB boards and CAD components pass the same surface strings used
 * for live cursors/locks ("pcb:<boardId>", "cad:<componentId>").
 *
 * Commenting is discussion, not document editing, so it needs project.read
 * like chat — a reviewer without edit rights can still point at a footprint.
 */
export const commentsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        surface: z.string().min(1).max(200),
        includeResolved: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      const comments = await prisma.viewportComment.findMany({
        where: {
          projectId: input.projectId,
          branchId: input.branchId,
          surface: input.surface,
          ...(input.includeResolved ? {} : { resolvedAt: null }),
        },
        orderBy: { createdAt: "asc" },
      });
      const authorIds = [...new Set(comments.map((c) => c.authorId))];
      const authors = await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true },
      });
      const nameOf = new Map(authors.map((a) => [a.id, a.name]));
      return comments.map((c) => ({
        ...c,
        authorName: nameOf.get(c.authorId) ?? "Someone",
      }));
    }),

  add: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        surface: z.string().min(1).max(200),
        x: z.number().finite(),
        y: z.number().finite(),
        body: z.string().min(1).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "project.read",
      );
      const comment = await prisma.viewportComment.create({
        data: {
          projectId: input.projectId,
          branchId: input.branchId,
          surface: input.surface,
          x: input.x,
          y: input.y,
          body: input.body,
          authorId: ctx.user.id,
        },
      });
      await recordAudit({
        type: "ViewportCommentCreated",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { commentId: comment.id, surface: input.surface },
      });
      return comment;
    }),

  resolve: protectedProcedure
    .input(z.object({ id: z.string(), resolved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.viewportComment.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        existing.projectId,
        "project.read",
      );
      const comment = await prisma.viewportComment.update({
        where: { id: input.id },
        data: input.resolved
          ? { resolvedAt: new Date(), resolvedById: ctx.user.id }
          : { resolvedAt: null, resolvedById: null },
      });
      await recordAudit({
        type: input.resolved ? "ViewportCommentResolved" : "ViewportCommentReopened",
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        actorId: ctx.user.id,
        payload: { commentId: comment.id, surface: existing.surface },
      });
      return comment;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.viewportComment.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        existing.projectId,
        // Anyone may resolve, but deleting someone else's words needs manage.
        existing.authorId === ctx.user.id ? "project.read" : "project.manage",
      );
      await prisma.viewportComment.delete({ where: { id: input.id } });
      await recordAudit({
        type: "ViewportCommentDeleted",
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        actorId: ctx.user.id,
        payload: { commentId: existing.id, surface: existing.surface },
      });
      return { ok: true };
    }),
});
