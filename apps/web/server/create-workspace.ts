import { prisma } from "@foundry/db";
import { slugify } from "@foundry/domain";
import { recordAudit } from "./audit";

/** Default personal workspace name for a newly created user (max 80 chars). */
export function defaultWorkspaceName(userName: string): string {
  const trimmed = userName.trim();
  if (!trimmed) return "My Workspace";
  const suffix = "'s Workspace";
  const maxBase = 80 - suffix.length;
  return `${trimmed.slice(0, maxBase)}${suffix}`;
}

/** Create a workspace owned by `userId`, with unique slug and audit event. */
export async function createWorkspaceForOwner(params: {
  userId: string;
  name: string;
}) {
  const name = params.name.trim().slice(0, 80);
  if (!name) {
    throw new Error("Workspace name is required");
  }

  const base = slugify(name);
  let slug = base;
  for (let i = 2; await prisma.workspace.findUnique({ where: { slug } }); i++) {
    slug = `${base}-${i}`;
  }

  const workspace = await prisma.workspace.create({
    data: {
      name,
      slug,
      createdById: params.userId,
      memberships: { create: { userId: params.userId, role: "OWNER" } },
    },
  });

  await recordAudit({
    type: "WorkspaceCreated",
    workspaceId: workspace.id,
    actorId: params.userId,
    payload: { name: workspace.name, slug: workspace.slug },
  });

  return workspace;
}
