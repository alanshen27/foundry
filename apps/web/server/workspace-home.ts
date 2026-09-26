import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import { createWorkspaceForOwner, defaultWorkspaceName } from "./create-workspace";

/** Open the last accessible project directly in its assembly viewport. */
export async function resolveViewportHomePath(
  userId: string,
  lastProjectId?: string,
): Promise<string> {
  const accessible = {
    status: "ACTIVE" as const,
    workspace: { memberships: { some: { userId } } },
    branches: { some: {} },
  };
  const select = { slug: true, workspace: { select: { slug: true } } };
  const previous =
    lastProjectId && lastProjectId.length <= 128
      ? await prisma.project.findFirst({ where: { ...accessible, id: lastProjectId }, select })
      : null;
  if (previous)
    return `/w/${previous.workspace.slug}/projects/${previous.slug}/engineer?view=assembly`;
  const workspacePath = await resolveWorkspaceHomePath(userId);
  const slug = workspacePath.slice("/w/".length);
  const latest = await prisma.project.findFirst({
    where: { ...accessible, workspace: { ...accessible.workspace, slug } },
    orderBy: { createdAt: "desc" },
    select,
  });
  return latest
    ? `/w/${latest.workspace.slug}/projects/${latest.slug}/engineer?view=assembly`
    : workspacePath;
}

/**
 * Resolve the signed-in home URL: prefer configured slug (if the user is a
 * member), else their earliest workspace. Always ensures at least one
 * workspace exists (accounts get one on signup/login).
 */
export async function resolveWorkspaceHomePath(userId: string): Promise<string> {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    include: { workspace: { select: { slug: true, createdAt: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (memberships.length === 0) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const workspace = await createWorkspaceForOwner({
      userId,
      name: defaultWorkspaceName(user.name),
    });
    return `/w/${workspace.slug}`;
  }

  const preferred = getServerEnv().FOUNDRY_DEFAULT_WORKSPACE_SLUG?.trim();
  if (preferred) {
    const match = memberships.find((m) => m.workspace.slug === preferred);
    if (match) return `/w/${match.workspace.slug}`;
  }

  // Stable pick: oldest membership (usually the seed / primary workspace).
  const first = memberships[0]!;
  return `/w/${first.workspace.slug}`;
}
