import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { cadDoc } from "@foundry/cad";
import { prisma, type Prisma } from "@foundry/db";
import { slugify, STAGES } from "@foundry/domain";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireWorkspaceCapability } from "../access";
import { previewModelDoc, projectThumbnailKey } from "@/lib/project-preview";
import { screenshotRenderPage } from "../ai/render";
import { appOrigin } from "../app-origin";
import { mintRenderToken } from "../render-token";
import { getObjectStorage } from "../storage";

export const projectRouter = router({
  /**
   * The signed-in user's own identity. Client components deep in the tree
   * (live cursors, for one) need to label themselves, and a query is far less
   * invasive than threading the viewer through every stage component.
   */
  viewer: protectedProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { id: true, name: true, avatarUrl: true },
    });
    return user ?? { id: ctx.user.id, name: "You", avatarUrl: null };
  }),

  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        name: z.string().min(1).max(80),
        description: z.string().max(500).optional(),
        folderId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Any member with research.edit can start a project (MEMBER default).
      await requireWorkspaceCapability(ctx.user.id, input.workspaceId, "research.edit");

      const folderId = input.folderId ?? null;
      if (folderId) {
        const folder = await prisma.projectFolder.findFirst({
          where: { id: folderId, workspaceId: input.workspaceId },
        });
        if (!folder) throw new TRPCError({ code: "BAD_REQUEST", message: "Folder not found" });
      }

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
          folderId,
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
      await prisma.designDoc.create({
        data: {
          projectId: project.id,
          branchId: branch.id,
          kind: "MODEL3D",
          data: cadDoc("") as unknown as Prisma.InputJsonValue,
          updatedById: ctx.user.id,
        },
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

  moveToFolder: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        folderId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await prisma.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(ctx.user.id, project.workspaceId, "research.edit");
      if (input.folderId) {
        const folder = await prisma.projectFolder.findFirst({
          where: { id: input.folderId, workspaceId: project.workspaceId },
        });
        if (!folder) throw new TRPCError({ code: "BAD_REQUEST", message: "Folder not found" });
      }
      const updated = await prisma.project.update({
        where: { id: input.projectId },
        data: { folderId: input.folderId },
      });
      await recordAudit({
        type: "ProjectMovedToFolder",
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: ctx.user.id,
        payload: { folderId: input.folderId },
      });
      return updated;
    }),

  /**
   * Render the project's 3D model to a cached PNG for workspace cards.
   *
   * Slow (headless browser + Zoo stream), so callers fire it in the background
   * and let the card fall back to a placeholder until it lands.
   */
  refreshThumbnail: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = await prisma.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(
        ctx.user.id,
        project.workspaceId,
        "mechanical.edit",
        project.id,
      );
      // No CAD doc means nothing worth rendering; the card keeps its placeholder.
      const docs = await prisma.designDoc.findMany({
        where: { projectId: project.id, kind: "MODEL3D" },
        select: { branchId: true, updatedAt: true },
      });
      const doc = previewModelDoc(project.activeBranchId, docs);
      if (!doc) return { ok: false as const, reason: "no-model" as const };
      const branchId = doc.branchId;

      const token = mintRenderToken({ projectId: project.id, branchId, kind: "model3d" });
      // tight=1: fill the frame, no grid or axes — a product shot, not an editor.
      const url = `${appOrigin()}/render/model3d?token=${encodeURIComponent(token)}&view=iso&tight=1`;
      const key = projectThumbnailKey(project.id);
      try {
        // Never cache a blank tile: better to keep the placeholder and retry.
        const png = await screenshotRenderPage(url, {
          // 4:3, matching the card tile.
          width: 640,
          height: 480,
          readyTimeout: 45_000,
          requireReady: true,
        });
        await getObjectStorage().put(key, new Uint8Array(png), "image/png");
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The project preview could not be rendered.",
        });
      }

      // Stamp with the doc's mtime, not now(), so an edit mid-render still reads as stale.
      const updated = await prisma.project.update({
        where: { id: project.id },
        data: { thumbnailKey: key, thumbnailUpdatedAt: doc.updatedAt },
        select: { thumbnailKey: true, thumbnailUpdatedAt: true },
      });

      await recordAudit({
        type: "ProjectThumbnailRendered",
        workspaceId: project.workspaceId,
        projectId: project.id,
        branchId,
        actorId: ctx.user.id,
        payload: { key },
      });

      return { ok: true as const, ...updated };
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
      await prisma.designDoc.create({
        data: {
          projectId: project.id,
          branchId: branch.id,
          kind: "MODEL3D",
          data: cadDoc("") as unknown as Prisma.InputJsonValue,
          updatedById: ctx.user.id,
        },
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
