import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { assignableRoles, slugify, WORKSPACE_ROLES } from "@foundry/domain";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireWorkspaceCapability } from "../access";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export const workspaceRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    prisma.workspace.findMany({
      where: { memberships: { some: { userId: ctx.user.id } } },
      include: { _count: { select: { projects: true, memberships: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const base = slugify(input.name);
      let slug = base;
      for (let i = 2; await prisma.workspace.findUnique({ where: { slug } }); i++) {
        slug = `${base}-${i}`;
      }
      const workspace = await prisma.workspace.create({
        data: {
          name: input.name,
          slug,
          createdById: ctx.user.id,
          memberships: { create: { userId: ctx.user.id, role: "OWNER" } },
        },
      });
      await recordAudit({
        type: "WorkspaceCreated",
        workspaceId: workspace.id,
        actorId: ctx.user.id,
        payload: { name: workspace.name, slug: workspace.slug },
      });
      return workspace;
    }),

  inviteMember: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        email: z.string().email(),
        role: z.enum(WORKSPACE_ROLES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { role: actorRole } = await requireWorkspaceCapability(
        ctx.user.id,
        input.workspaceId,
        "project.manage",
      );
      if (!assignableRoles(actorRole).includes(input.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `A ${actorRole} cannot invite a ${input.role}`,
        });
      }
      const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
      if (existingUser) {
        const existingMembership = await prisma.workspaceMembership.findUnique({
          where: {
            workspaceId_userId: { workspaceId: input.workspaceId, userId: existingUser.id },
          },
        });
        if (existingMembership) {
          throw new TRPCError({ code: "CONFLICT", message: "Already a member" });
        }
      }
      const invitation = await prisma.invitation.create({
        data: {
          workspaceId: input.workspaceId,
          email: input.email,
          role: input.role,
          token: randomBytes(24).toString("base64url"),
          invitedById: ctx.user.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
      await recordAudit({
        type: "WorkspaceMemberInvited",
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        payload: { email: input.email, role: input.role, invitationId: invitation.id },
      });
      return invitation;
    }),

  acceptInvitation: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await prisma.invitation.findUnique({
        where: { token: input.token },
        include: { workspace: true },
      });
      if (!invitation || invitation.status !== "PENDING") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invitation not found or already used" });
      }
      if (invitation.expiresAt < new Date()) {
        await prisma.invitation.update({
          where: { id: invitation.id },
          data: { status: "EXPIRED" },
        });
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invitation has expired" });
      }
      if (invitation.email.toLowerCase() !== ctx.user.email.toLowerCase()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This invitation was issued for a different email address",
        });
      }
      await prisma.$transaction([
        prisma.workspaceMembership.upsert({
          where: {
            workspaceId_userId: { workspaceId: invitation.workspaceId, userId: ctx.user.id },
          },
          update: {},
          create: {
            workspaceId: invitation.workspaceId,
            userId: ctx.user.id,
            role: invitation.role,
          },
        }),
        prisma.invitation.update({
          where: { id: invitation.id },
          data: { status: "ACCEPTED", acceptedAt: new Date() },
        }),
      ]);
      await recordAudit({
        type: "WorkspaceMemberAdded",
        workspaceId: invitation.workspaceId,
        actorId: ctx.user.id,
        payload: { role: invitation.role, invitationId: invitation.id },
      });
      return { workspaceSlug: invitation.workspace.slug };
    }),
});
