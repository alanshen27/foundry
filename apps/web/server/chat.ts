import "server-only";
import { prisma } from "@foundry/db";

export const DEFAULT_CHANNEL_NAME = "General";
export const DEFAULT_CATEGORY_NAME = "Text Channels";

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String(err.code) : "";
  const message = err instanceof Error ? err.message : String(err);
  return code === "P2002" || /Unique constraint/i.test(message);
}

/**
 * Find-or-create that survives concurrent layout loads. Prisma's upsert still
 * races under the Supabase pooler: both sides miss, both create, one gets P2002.
 */
async function findOrCreateCategory(projectId: string, branchId: string) {
  const where = {
    projectId_branchId_name: {
      projectId,
      branchId,
      name: DEFAULT_CATEGORY_NAME,
    },
  } as const;

  const existing = await prisma.chatChannelCategory.findUnique({ where });
  if (existing) return existing;

  try {
    return await prisma.chatChannelCategory.create({
      data: {
        projectId,
        branchId,
        name: DEFAULT_CATEGORY_NAME,
        sortOrder: 0,
      },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return prisma.chatChannelCategory.findUniqueOrThrow({ where });
  }
}

async function findOrCreateChannel(
  projectId: string,
  branchId: string,
  categoryId: string,
) {
  const where = {
    projectId_branchId_name: { projectId, branchId, name: DEFAULT_CHANNEL_NAME },
  } as const;

  const existing = await prisma.chatChannel.findUnique({ where });
  if (existing) return existing;

  try {
    return await prisma.chatChannel.create({
      data: {
        projectId,
        branchId,
        name: DEFAULT_CHANNEL_NAME,
        categoryId,
        sortOrder: 0,
      },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return prisma.chatChannel.findUniqueOrThrow({ where });
  }
}

export async function ensureDefaultCategory(projectId: string, branchId: string) {
  return findOrCreateCategory(projectId, branchId);
}

/**
 * Every branch has a default "Text Channels" category and "General" channel.
 * Also adopts legacy messages written before channels existed (channelId null).
 */
export async function ensureDefaultChannel(projectId: string, branchId: string) {
  const category = await findOrCreateCategory(projectId, branchId);
  const channel = await findOrCreateChannel(projectId, branchId, category.id);

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
