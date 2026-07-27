import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { requireProjectCapability } from "../access";
import { recordAudit } from "../audit";
import {
  DEFAULT_CATEGORY_NAME,
  DEFAULT_CHANNEL_NAME,
  ensureDefaultCategory,
  ensureDefaultChannel,
} from "../chat";
import { loadChannelHistory } from "../chat-run/persist";
import { publishRunFinished } from "../chat-run/publish";
import { expireStaleChatRuns } from "../chat-run/stale";

const channelSelect = {
  id: true,
  name: true,
  categoryId: true,
  sortOrder: true,
} as const;

const categorySelect = {
  id: true,
  name: true,
  sortOrder: true,
} as const;

export const chatRouter = router({
  channels: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      await ensureDefaultChannel(input.projectId, input.branchId);
      const [categories, channels] = await Promise.all([
        prisma.chatChannelCategory.findMany({
          where: { projectId: input.projectId, branchId: input.branchId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: categorySelect,
        }),
        prisma.chatChannel.findMany({
          where: { projectId: input.projectId, branchId: input.branchId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: channelSelect,
        }),
      ]);
      return { categories, channels };
    }),

  messages: protectedProcedure
    .input(z.object({ projectId: z.string(), channelId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      return loadChannelHistory(input.projectId, input.channelId);
    }),

  activeRun: protectedProcedure
    .input(z.object({ projectId: z.string(), channelId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      await expireStaleChatRuns(input.channelId);
      return prisma.chatRun.findFirst({
        where: {
          projectId: input.projectId,
          channelId: input.channelId,
          status: { in: ["PENDING", "RUNNING"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, createdAt: true },
      });
    }),

  cancelActiveRun: protectedProcedure
    .input(z.object({ projectId: z.string(), channelId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "agent.invoke");
      const active = await prisma.chatRun.findMany({
        where: {
          projectId: input.projectId,
          channelId: input.channelId,
          status: { in: ["PENDING", "RUNNING"] },
        },
        select: { id: true },
      });
      if (active.length === 0) return { ok: true };
      await prisma.chatRun.updateMany({
        where: {
          projectId: input.projectId,
          channelId: input.channelId,
          status: { in: ["PENDING", "RUNNING"] },
        },
        data: { status: "CANCELLED", finishedAt: new Date(), error: "cancelled" },
      });
      await Promise.all(
        active.map((run) => publishRunFinished(run.id, input.channelId, "cancelled")),
      );
      return { ok: true };
    }),

  createCategory: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        name: z.string().trim().min(1).max(40),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "agent.invoke",
      );
      const existing = await prisma.chatChannelCategory.findUnique({
        where: {
          projectId_branchId_name: {
            projectId: input.projectId,
            branchId: input.branchId,
            name: input.name,
          },
        },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A category with that name exists" });
      }
      const maxOrder = await prisma.chatChannelCategory.aggregate({
        where: { projectId: input.projectId, branchId: input.branchId },
        _max: { sortOrder: true },
      });
      const category = await prisma.chatChannelCategory.create({
        data: {
          projectId: input.projectId,
          branchId: input.branchId,
          name: input.name,
          sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        },
        select: categorySelect,
      });
      await recordAudit({
        type: "ChatChannelCategoryCreated",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { categoryId: category.id, name: category.name },
      });
      return category;
    }),

  deleteCategory: protectedProcedure
    .input(z.object({ projectId: z.string(), categoryId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "agent.invoke",
      );
      const category = await prisma.chatChannelCategory.findFirst({
        where: { id: input.categoryId, projectId: input.projectId },
      });
      if (!category) throw new TRPCError({ code: "NOT_FOUND" });
      if (category.name === DEFAULT_CATEGORY_NAME) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The Text Channels category cannot be deleted",
        });
      }
      const fallback = await ensureDefaultCategory(input.projectId, category.branchId);
      await prisma.chatChannel.updateMany({
        where: { categoryId: category.id },
        data: { categoryId: fallback.id },
      });
      await prisma.chatChannelCategory.delete({ where: { id: category.id } });
      await recordAudit({
        type: "ChatChannelCategoryDeleted",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: category.branchId,
        actorId: ctx.user.id,
        payload: { categoryId: category.id, name: category.name },
      });
      return { ok: true };
    }),

  createChannel: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        name: z.string().trim().min(1).max(40),
        categoryId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "agent.invoke",
      );
      const existing = await prisma.chatChannel.findUnique({
        where: {
          projectId_branchId_name: {
            projectId: input.projectId,
            branchId: input.branchId,
            name: input.name,
          },
        },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A channel with that name exists" });
      }

      let categoryId = input.categoryId;
      if (categoryId) {
        const category = await prisma.chatChannelCategory.findFirst({
          where: {
            id: categoryId,
            projectId: input.projectId,
            branchId: input.branchId,
          },
        });
        if (!category) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown category" });
      } else {
        categoryId = (await ensureDefaultCategory(input.projectId, input.branchId)).id;
      }

      const maxOrder = await prisma.chatChannel.aggregate({
        where: { projectId: input.projectId, branchId: input.branchId, categoryId },
        _max: { sortOrder: true },
      });

      const channel = await prisma.chatChannel.create({
        data: {
          projectId: input.projectId,
          branchId: input.branchId,
          name: input.name,
          categoryId,
          sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        },
        select: channelSelect,
      });
      await recordAudit({
        type: "ChatChannelCreated",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { channelId: channel.id, name: channel.name, categoryId },
      });
      return channel;
    }),

  deleteChannel: protectedProcedure
    .input(z.object({ projectId: z.string(), channelId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "agent.invoke",
      );
      const channel = await prisma.chatChannel.findFirst({
        where: { id: input.channelId, projectId: input.projectId },
      });
      if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
      if (channel.name === DEFAULT_CHANNEL_NAME) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The General channel cannot be deleted",
        });
      }
      await prisma.chatChannel.delete({ where: { id: channel.id } });
      await recordAudit({
        type: "ChatChannelDeleted",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: channel.branchId,
        actorId: ctx.user.id,
        payload: { channelId: channel.id, name: channel.name },
      });
      return { ok: true };
    }),
});
