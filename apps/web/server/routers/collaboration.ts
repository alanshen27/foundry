import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  codeFileRoom,
  sitePromptRoom,
  designDocumentRoom,
  DESIGN_KINDS,
} from "@foundry/collaboration";
import { prisma } from "@foundry/db";
import { hasCollaborationState, loadCollaborationDocument } from "@foundry/collaboration/server";
import { normalizeCadDoc } from "@foundry/cad";
import { normalizePcbSet } from "@/lib/pcb/doc";
import { normalizeCircuitDoc } from "@/lib/circuit/catalog";
import { hasCapability, type Capability } from "@foundry/domain";
import { protectedProcedure, router } from "../trpc";
import { requireProjectCapability, requireWorkspaceCapability } from "../access";
import {
  getCollabWebsocketUrl,
  mintCodeFileCollabToken,
  mintSitePromptCollabToken,
  mintDesignCollabToken,
} from "../collab-token";

export const collaborationRouter = router({
  designSession: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        branchId: z.string().min(1),
        kind: z.enum(DESIGN_KINDS),
      }),
    )
    .query(async ({ ctx, input }) => {
      const url = getCollabWebsocketUrl();
      if (!url) return null;
      const documentName = designDocumentRoom(input.projectId, input.branchId, input.kind);
      // Authorization completes before the room-existence result is used.
      const [{ project, membership, role }, branch, seeded] = await Promise.all([
        requireProjectCapability(ctx.user.id, input.projectId, "project.read"),
        prisma.projectBranch.findFirst({
          where: { id: input.branchId, projectId: input.projectId },
          select: { id: true },
        }),
        hasCollaborationState(documentName),
      ]);
      if (!branch) throw new TRPCError({ code: "NOT_FOUND", message: "Project branch not found" });
      const grants = membership.grants
        .filter((g) => g.projectId === null || g.projectId === input.projectId)
        .map((g) => g.capability as Capability);
      const capability =
        input.kind === "MODEL3D"
          ? "mechanical.edit"
          : input.kind === "DESIGN"
            ? "site.edit"
            : "electronics.edit";
      const canEdit = hasCapability(role, grants, capability);
      // Seed one canonical identity set before issuing a room token. This also
      // upgrades legacy single-board data and makes simultaneous first edits
      // share the same empty arrays/board instead of racing to replace a root.
      // Rooms are never un-seeded, so an existing row skips the locking transaction.
      if (!seeded)
        await loadCollaborationDocument(documentName, (data) =>
          input.kind === "PCB"
            ? normalizePcbSet(data)
            : input.kind === "CIRCUIT"
              ? normalizeCircuitDoc(data)
              : input.kind === "MODEL3D"
                ? normalizeCadDoc(data)
                : (data ?? {}),
        );
      const user = { id: ctx.user.id, name: ctx.user.name, avatarUrl: ctx.user.avatarUrl };
      return {
        url,
        documentName,
        canEdit,
        user,
        projectId: project.id,
        token: mintDesignCollabToken({
          resourceId: documentName,
          userId: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl,
          canEdit,
        }),
      };
    }),
  /**
   * Mint a short-lived token + room info for a CodeFile Yjs session.
   * Returns null when NEXT_PUBLIC_COLLAB_URL is unset (single-player fallback).
   */
  codeFileSession: protectedProcedure
    .input(z.object({ fileId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const url = getCollabWebsocketUrl();
      if (!url) return null;

      const file = await prisma.codeFile.findUnique({ where: { id: input.fileId } });
      if (!file) throw new TRPCError({ code: "NOT_FOUND" });

      const { project, membership, role } = await requireProjectCapability(
        ctx.user.id,
        file.projectId,
        "project.read",
      );

      const grants = (
        await prisma.capabilityGrant.findMany({
          where: {
            membershipId: membership.id,
            OR: [{ projectId: null }, { projectId: file.projectId }],
          },
        })
      ).map((g) => g.capability as Capability);
      const canEdit = hasCapability(role, grants, "software.edit");

      const documentName = codeFileRoom(file.id);
      const token = mintCodeFileCollabToken({
        resourceId: file.id,
        userId: ctx.user.id,
        name: ctx.user.name,
        avatarUrl: ctx.user.avatarUrl,
        canEdit,
      });

      return {
        url,
        token,
        documentName,
        canEdit,
        user: {
          id: ctx.user.id,
          name: ctx.user.name,
          avatarUrl: ctx.user.avatarUrl,
        },
        projectId: project.id,
      };
    }),

  /**
   * Mint a short-lived token + room info for a Site shared prompt draft.
   * Returns null when NEXT_PUBLIC_COLLAB_URL is unset (single-player fallback).
   */
  siteSession: protectedProcedure
    .input(z.object({ siteId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const url = getCollabWebsocketUrl();
      if (!url) return null;

      const site = await prisma.site.findUnique({ where: { id: input.siteId } });
      if (!site) throw new TRPCError({ code: "NOT_FOUND" });

      const { membership, role } = await requireWorkspaceCapability(
        ctx.user.id,
        site.workspaceId,
        "project.read",
        site.projectId ?? undefined,
      );

      const grants = (
        await prisma.capabilityGrant.findMany({
          where: {
            membershipId: membership.id,
            OR: [{ projectId: null }, ...(site.projectId ? [{ projectId: site.projectId }] : [])],
          },
        })
      ).map((g) => g.capability as Capability);
      const canEdit = hasCapability(role, grants, "site.edit");

      const documentName = sitePromptRoom(site.id);
      const token = mintSitePromptCollabToken({
        resourceId: site.id,
        userId: ctx.user.id,
        name: ctx.user.name,
        avatarUrl: ctx.user.avatarUrl,
        canEdit,
      });

      return {
        url,
        token,
        documentName,
        canEdit,
        user: {
          id: ctx.user.id,
          name: ctx.user.name,
          avatarUrl: ctx.user.avatarUrl,
        },
        siteId: site.id,
      };
    }),
});
