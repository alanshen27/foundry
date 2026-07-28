import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { codeFileRoom } from "@foundry/collaboration";
import { prisma } from "@foundry/db";
import { hasCapability, type Capability } from "@foundry/domain";
import { protectedProcedure, router } from "../trpc";
import { requireProjectCapability } from "../access";
import { getCollabWebsocketUrl, mintCodeFileCollabToken } from "../collab-token";

export const collaborationRouter = router({
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
        fileId: file.id,
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
});
