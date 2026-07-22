import { TRPCError } from "@trpc/server";
import { prisma, type Project, type WorkspaceMembership } from "@foundry/db";
import { hasCapability, type Capability, type WorkspaceRole } from "@foundry/domain";

export type WorkspaceAccess = {
  membership: WorkspaceMembership;
  role: WorkspaceRole;
};

export type ProjectAccess = WorkspaceAccess & { project: Project };

/**
 * Loads the caller's membership and asserts the required capability
 * (role defaults + explicit CapabilityGrant rows). Every mutating
 * procedure goes through this.
 */
export async function requireWorkspaceCapability(
  userId: string,
  workspaceId: string,
  capability: Capability,
  projectId?: string,
): Promise<WorkspaceAccess> {
  const membership = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { grants: true },
  });
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
  }
  const role = membership.role as WorkspaceRole;
  const grants = membership.grants
    .filter((g) => g.projectId === null || g.projectId === projectId)
    .map((g) => g.capability as Capability);
  if (!hasCapability(role, grants, capability)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Missing capability: ${capability}` });
  }
  return { membership, role };
}

/**
 * Loads a project and asserts the caller holds `capability` in its workspace.
 * Convenience wrapper used by every stage router.
 */
export async function requireProjectCapability(
  userId: string,
  projectId: string,
  capability: Capability,
): Promise<ProjectAccess> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  const access = await requireWorkspaceCapability(
    userId,
    project.workspaceId,
    capability,
    project.id,
  );
  return { ...access, project };
}
