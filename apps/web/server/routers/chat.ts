import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma, type Prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { requireProjectCapability } from "../access";
import { recordAudit } from "../audit";
import {
  DEFAULT_CATEGORY_NAME,
  DEFAULT_CHANNEL_NAME,
  ensureDefaultCategory,
  ensureDefaultChannel,
} from "../chat";
import { loadChannelHistory, persistRunMessages } from "../chat-run/persist";
import { publishRunFinished } from "../chat-run/publish";
import { expireStaleChatRuns } from "../chat-run/stale";
import { markFailedAssistantMessages, validateResumableUIMessages } from "@/lib/copilot/messages";
import { CHAT_REACTION_EMOJIS } from "@/lib/copilot/chat-message-meta";
import type { UIMessage } from "ai";

const reactionEmojiSchema = z.enum(CHAT_REACTION_EMOJIS);

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
      return loadChannelHistory(input.projectId, input.channelId, ctx.user.id);
    }),

  editMessage: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        messageId: z.string(),
        text: z.string().trim().min(1).max(8000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "agent.invoke",
      );
      const message = await prisma.chatMessage.findFirst({
        where: { id: input.messageId, projectId: input.projectId },
        select: {
          id: true,
          role: true,
          authorUserId: true,
          deletedAt: true,
          branchId: true,
          channelId: true,
        },
      });
      if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      if (message.role !== "user" || message.authorUserId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only edit your own messages" });
      }
      if (message.deletedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot edit a deleted message" });
      }
      const editedAt = new Date();
      const updated = await prisma.chatMessage.update({
        where: { id: message.id },
        data: {
          parts: [{ type: "text", text: input.text }] as unknown as Prisma.InputJsonValue,
          editedAt,
        },
        select: { id: true, editedAt: true },
      });
      await recordAudit({
        type: "ChatMessageEdited",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: message.branchId,
        actorId: ctx.user.id,
        payload: { messageId: message.id, channelId: message.channelId },
      });
      return {
        id: updated.id,
        editedAt: updated.editedAt?.toISOString() ?? editedAt.toISOString(),
      };
    }),

  deleteMessage: protectedProcedure
    .input(z.object({ projectId: z.string(), messageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "agent.invoke",
      );
      const message = await prisma.chatMessage.findFirst({
        where: { id: input.messageId, projectId: input.projectId },
        select: {
          id: true,
          role: true,
          authorUserId: true,
          deletedAt: true,
          branchId: true,
          channelId: true,
        },
      });
      if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      if (message.role !== "user" || message.authorUserId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete your own messages",
        });
      }
      if (message.deletedAt)
        return { ok: true as const, deletedAt: message.deletedAt.toISOString() };
      const deletedAt = new Date();
      await prisma.chatMessage.update({
        where: { id: message.id },
        data: {
          deletedAt,
          parts: [{ type: "text", text: "Message deleted" }] as unknown as Prisma.InputJsonValue,
        },
      });
      await recordAudit({
        type: "ChatMessageDeleted",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: message.branchId,
        actorId: ctx.user.id,
        payload: { messageId: message.id, channelId: message.channelId },
      });
      return { ok: true as const, deletedAt: deletedAt.toISOString() };
    }),

  toggleReaction: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        messageId: z.string(),
        emoji: reactionEmojiSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "project.read",
      );
      const message = await prisma.chatMessage.findFirst({
        where: { id: input.messageId, projectId: input.projectId },
        select: { id: true, deletedAt: true, branchId: true, channelId: true },
      });
      if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      if (message.deletedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot react to a deleted message" });
      }

      const existing = await prisma.chatMessageReaction.findUnique({
        where: {
          messageId_userId_emoji: {
            messageId: message.id,
            userId: ctx.user.id,
            emoji: input.emoji,
          },
        },
        select: { id: true },
      });

      let added = false;
      if (existing) {
        await prisma.chatMessageReaction.delete({ where: { id: existing.id } });
      } else {
        await prisma.chatMessageReaction.create({
          data: {
            messageId: message.id,
            userId: ctx.user.id,
            emoji: input.emoji,
          },
        });
        added = true;
      }

      const reactions = await prisma.chatMessageReaction.findMany({
        where: { messageId: message.id },
        select: { emoji: true, userId: true },
      });
      const byEmoji = new Map<string, { count: number; me: boolean }>();
      for (const row of reactions) {
        const cur = byEmoji.get(row.emoji) ?? { count: 0, me: false };
        cur.count += 1;
        if (row.userId === ctx.user.id) cur.me = true;
        byEmoji.set(row.emoji, cur);
      }
      const summary = [...byEmoji.entries()]
        .map(([emoji, v]) => ({ emoji, count: v.count, me: v.me }))
        .sort((a, b) => a.emoji.localeCompare(b.emoji));

      await recordAudit({
        type: "ChatReactionToggled",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: message.branchId,
        actorId: ctx.user.id,
        payload: {
          messageId: message.id,
          channelId: message.channelId,
          emoji: input.emoji,
          added,
        },
      });
      return { messageId: message.id, added, reactions: summary };
    }),

  /**
   * Client-side safety net AFTER a failed/cancelled run. Never call this while
   * streaming — mid-stream upserts used to clobber worker checkpoints.
   * persistRunMessages is merge-safe (refuses to downgrade richer parts).
   */
  persistMessages: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        channelId: z.string(),
        messages: z.array(z.unknown()),
        error: z.string().trim().min(1).max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "agent.invoke");
      const channel = await prisma.chatChannel.findFirst({
        where: {
          id: input.channelId,
          projectId: input.projectId,
          branchId: input.branchId,
        },
        select: { id: true },
      });
      if (!channel) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown channel" });

      // Refuse while a run is still live — client snapshots race the worker.
      const active = await prisma.chatRun.findFirst({
        where: {
          projectId: input.projectId,
          channelId: input.channelId,
          status: { in: ["PENDING", "RUNNING"] },
        },
        select: { id: true },
      });
      if (active && !input.error) {
        return { ok: true, count: 0, skipped: "active_run" as const };
      }

      let messages: UIMessage[];
      try {
        messages = await validateResumableUIMessages(input.messages);
      } catch {
        messages = (input.messages as UIMessage[]).filter(
          (m) => m && typeof m === "object" && typeof m.id === "string" && Array.isArray(m.parts),
        );
      }
      if (messages.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid chat messages" });
      }
      if (input.error) {
        messages = markFailedAssistantMessages(messages, input.error);
      }
      const count = await persistRunMessages(
        {
          projectId: input.projectId,
          branchId: input.branchId,
          channelId: input.channelId,
        },
        messages,
      );
      return { ok: true, count };
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
    .input(
      z.object({
        projectId: z.string(),
        channelId: z.string().optional(),
        branchId: z.string().optional(),
        /** Prefer canceling one run — branch-wide cancel races with a just-started send. */
        runId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "agent.invoke");

      const where: {
        projectId: string;
        status: { in: ("PENDING" | "RUNNING")[] };
        id?: string;
        branchId?: string;
        channelId?: string;
      } = {
        projectId: input.projectId,
        status: { in: ["PENDING", "RUNNING"] },
      };
      if (input.runId) {
        where.id = input.runId;
      } else if (input.branchId) {
        where.branchId = input.branchId;
      } else if (input.channelId) {
        where.channelId = input.channelId;
      }

      const active = await prisma.chatRun.findMany({
        where,
        select: { id: true, channelId: true },
      });
      if (active.length === 0) return { ok: true };
      await prisma.chatRun.updateMany({
        where: { id: { in: active.map((run) => run.id) } },
        data: { status: "CANCELLED", finishedAt: new Date(), error: "cancelled" },
      });
      await Promise.all(
        active.map((run) => publishRunFinished(run.id, run.channelId, "cancelled")),
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
