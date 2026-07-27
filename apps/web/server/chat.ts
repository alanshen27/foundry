import "server-only";
import { prisma } from "@foundry/db";

export const DEFAULT_CHANNEL_NAME = "General";
export const DEFAULT_CATEGORY_NAME = "Text Channels";

export async function ensureDefaultCategory(projectId: string, branchId: string) {
  return prisma.chatChannelCategory.upsert({
    where: {
      projectId_branchId_name: {
        projectId,
        branchId,
        name: DEFAULT_CATEGORY_NAME,
      },
    },
    create: {
      projectId,
      branchId,
      name: DEFAULT_CATEGORY_NAME,
      sortOrder: 0,
    },
    update: {},
  });
}

/**
 * Every branch has a default "Text Channels" category and "General" channel.
 * Also adopts legacy messages written before channels existed (channelId null).
 */
export async function ensureDefaultChannel(projectId: string, branchId: string) {
  const category = await ensureDefaultCategory(projectId, branchId);

  const channel = await prisma.chatChannel.upsert({
    where: {
      projectId_branchId_name: { projectId, branchId, name: DEFAULT_CHANNEL_NAME },
    },
    create: {
      projectId,
      branchId,
      name: DEFAULT_CHANNEL_NAME,
      categoryId: category.id,
      sortOrder: 0,
    },
    update: {},
  });

  if (!channel.categoryId) {
    await prisma.chatChannel.update({
      where: { id: channel.id },
      data: { categoryId: category.id },
    });
  }

  // Assign uncategorized channels to the default category.
  await prisma.chatChannel.updateMany({
    where: { projectId, branchId, categoryId: null },
    data: { categoryId: category.id },
  });

  await prisma.chatMessage.updateMany({
    where: { projectId, branchId, channelId: null },
    data: { channelId: channel.id },
  });

  return prisma.chatChannel.findUniqueOrThrow({ where: { id: channel.id } });
}
