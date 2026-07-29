import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { getObjectStorage } from "../storage";

const AVATAR_MIME_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

type AvatarMimeType = keyof typeof AVATAR_MIME_TYPES;

/** Prefer a workspace the user owns/admins so ProfileUpdated lands somewhere auditable. */
async function auditWorkspaceIdForUser(userId: string): Promise<string | null> {
  const membership = await prisma.workspaceMembership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true },
  });
  return membership?.workspaceId ?? null;
}

export const userRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({
    id: ctx.user.id,
    email: ctx.user.email,
    name: ctx.user.name,
    avatarUrl: ctx.user.avatarUrl,
  })),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await prisma.user.update({
        where: { id: ctx.user.id },
        data: { name: input.name },
      });

      const workspaceId = await auditWorkspaceIdForUser(ctx.user.id);
      if (workspaceId) {
        await recordAudit({
          type: "ProfileUpdated",
          workspaceId,
          actorId: ctx.user.id,
          payload: { fields: ["name"] },
        });
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      };
    }),

  uploadAvatar: protectedProcedure
    .input(
      z.object({
        mimeType: z.enum(Object.keys(AVATAR_MIME_TYPES) as [AvatarMimeType, ...AvatarMimeType[]]),
        // Base64 body; keep avatars small (~2 MB decoded).
        contentBase64: z.string().max(3_000_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const body = Buffer.from(input.contentBase64, "base64");
      if (body.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Empty image" });
      }
      if (body.length > 2_000_000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Image must be under 2 MB" });
      }

      const ext = AVATAR_MIME_TYPES[input.mimeType];
      const key = `users/${ctx.user.id}/avatar-${randomUUID()}.${ext}`;
      const stored = await getObjectStorage().put(key, body, input.mimeType);
      const avatarUrl = `/api/files/${stored.key}`;

      const previousUrl = ctx.user.avatarUrl;
      const user = await prisma.user.update({
        where: { id: ctx.user.id },
        data: { avatarUrl },
      });

      // Best-effort cleanup of a previous Foundry-hosted avatar.
      if (previousUrl?.startsWith("/api/files/users/")) {
        const previousKey = previousUrl.slice("/api/files/".length);
        if (previousKey.startsWith(`users/${ctx.user.id}/`)) {
          await getObjectStorage()
            .delete(previousKey)
            .catch(() => undefined);
        }
      }

      const workspaceId = await auditWorkspaceIdForUser(ctx.user.id);
      if (workspaceId) {
        await recordAudit({
          type: "ProfileUpdated",
          workspaceId,
          actorId: ctx.user.id,
          payload: {
            fields: ["avatarUrl"],
            storageKey: stored.key,
            sha256: stored.sha256,
            backend: stored.backend,
          },
        });
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      };
    }),

  clearAvatar: protectedProcedure.mutation(async ({ ctx }) => {
    const previousUrl = ctx.user.avatarUrl;
    const user = await prisma.user.update({
      where: { id: ctx.user.id },
      data: { avatarUrl: null },
    });

    if (previousUrl?.startsWith("/api/files/users/")) {
      const previousKey = previousUrl.slice("/api/files/".length);
      if (previousKey.startsWith(`users/${ctx.user.id}/`)) {
        await getObjectStorage()
          .delete(previousKey)
          .catch(() => undefined);
      }
    }

    const workspaceId = await auditWorkspaceIdForUser(ctx.user.id);
    if (workspaceId) {
      await recordAudit({
        type: "ProfileUpdated",
        workspaceId,
        actorId: ctx.user.id,
        payload: { fields: ["avatarUrl"], cleared: true },
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };
  }),
});
