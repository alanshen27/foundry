import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { FOLDER_COLORS } from "@/lib/folder-color";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireWorkspaceCapability } from "../access";

const MAX_FOLDER_DEPTH = 8;

async function assertFolderInWorkspace(folderId: string, workspaceId: string) {
  const folder = await prisma.projectFolder.findFirst({
    where: { id: folderId, workspaceId },
  });
  if (!folder) throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
  return folder;
}

/** Walk parents to prevent cycles and enforce depth. */
async function assertValidParent(
  workspaceId: string,
  parentId: string | null | undefined,
  movingId?: string,
) {
  if (!parentId) return;
  if (movingId && parentId === movingId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A folder cannot be its own parent" });
  }
  let current: string | null = parentId;
  let depth = 0;
  while (current) {
    depth += 1;
    if (depth > MAX_FOLDER_DEPTH) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Folder nesting is too deep" });
    }
    if (movingId && current === movingId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot move a folder into itself" });
    }
    const row: { parentId: string | null; workspaceId: string } | null =
      await prisma.projectFolder.findUnique({
        where: { id: current },
        select: { parentId: true, workspaceId: true },
      });
    if (!row || row.workspaceId !== workspaceId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Parent folder not in workspace" });
    }
    current = row.parentId;
  }
}

export const folderRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireWorkspaceCapability(ctx.user.id, input.workspaceId, "project.read");
      return prisma.projectFolder.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, parentId: true, sortOrder: true, color: true },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        name: z.string().min(1).max(80),
        parentId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireWorkspaceCapability(ctx.user.id, input.workspaceId, "research.edit");
      const parentId = input.parentId ?? null;
      if (parentId) await assertFolderInWorkspace(parentId, input.workspaceId);
      await assertValidParent(input.workspaceId, parentId);

      const siblings = await prisma.projectFolder.count({
        where: { workspaceId: input.workspaceId, parentId },
      });

      const folder = await prisma.projectFolder.create({
        data: {
          workspaceId: input.workspaceId,
          parentId,
          name: input.name.trim(),
          sortOrder: siblings,
        },
      });

      await recordAudit({
        type: "ProjectFolderCreated",
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        payload: { folderId: folder.id, name: folder.name, parentId },
      });

      return folder;
    }),

  rename: protectedProcedure
    .input(z.object({ folderId: z.string(), name: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.projectFolder.findUnique({ where: { id: input.folderId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(ctx.user.id, existing.workspaceId, "research.edit");

      const folder = await prisma.projectFolder.update({
        where: { id: input.folderId },
        data: { name: input.name.trim() },
      });

      await recordAudit({
        type: "ProjectFolderRenamed",
        workspaceId: existing.workspaceId,
        actorId: ctx.user.id,
        payload: { folderId: folder.id, name: folder.name },
      });

      return folder;
    }),

  /** `null` clears the override and returns the folder to its derived hue. */
  setColor: protectedProcedure
    .input(
      z.object({
        folderId: z.string(),
        color: z.enum(FOLDER_COLORS).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.projectFolder.findUnique({ where: { id: input.folderId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(ctx.user.id, existing.workspaceId, "research.edit");

      const folder = await prisma.projectFolder.update({
        where: { id: input.folderId },
        data: { color: input.color },
      });

      await recordAudit({
        type: "ProjectFolderRecolored",
        workspaceId: existing.workspaceId,
        actorId: ctx.user.id,
        payload: { folderId: folder.id, color: input.color },
      });

      return folder;
    }),

  move: protectedProcedure
    .input(
      z.object({
        folderId: z.string(),
        parentId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.projectFolder.findUnique({ where: { id: input.folderId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(ctx.user.id, existing.workspaceId, "research.edit");
      if (input.parentId) {
        await assertFolderInWorkspace(input.parentId, existing.workspaceId);
      }
      await assertValidParent(existing.workspaceId, input.parentId, input.folderId);

      const folder = await prisma.projectFolder.update({
        where: { id: input.folderId },
        data: { parentId: input.parentId },
      });

      await recordAudit({
        type: "ProjectFolderMoved",
        workspaceId: existing.workspaceId,
        actorId: ctx.user.id,
        payload: { folderId: folder.id, parentId: input.parentId },
      });

      return folder;
    }),

  delete: protectedProcedure
    .input(z.object({ folderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.projectFolder.findUnique({ where: { id: input.folderId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(ctx.user.id, existing.workspaceId, "research.edit");

      // Re-home direct projects + child folders to this folder's parent, then delete.
      await prisma.$transaction([
        prisma.project.updateMany({
          where: { folderId: input.folderId },
          data: { folderId: existing.parentId },
        }),
        prisma.projectFolder.updateMany({
          where: { parentId: input.folderId },
          data: { parentId: existing.parentId },
        }),
        prisma.projectFolder.delete({ where: { id: input.folderId } }),
      ]);

      await recordAudit({
        type: "ProjectFolderDeleted",
        workspaceId: existing.workspaceId,
        actorId: ctx.user.id,
        payload: { folderId: input.folderId, name: existing.name },
      });

      return { ok: true as const };
    }),
});
