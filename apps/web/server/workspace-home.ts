import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";

/**
 * Resolve the signed-in home URL: prefer configured slug (if the user is a
 * member), else their earliest workspace. Falls back to the manage list only
 * when they have no memberships yet.
 */
export async function resolveWorkspaceHomePath(userId: string): Promise<string> {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    include: { workspace: { select: { slug: true, createdAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return "/workspaces?manage=1";

  const preferred = getServerEnv().FOUNDRY_DEFAULT_WORKSPACE_SLUG?.trim();
  if (preferred) {
    const match = memberships.find((m) => m.workspace.slug === preferred);
    if (match) return `/w/${match.workspace.slug}`;
  }

  // Stable pick: oldest membership (usually the seed / primary workspace).
  const first = memberships[0]!;
  return `/w/${first.workspace.slug}`;
}
