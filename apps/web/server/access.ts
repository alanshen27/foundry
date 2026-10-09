import { TRPCError } from "@trpc/server";
import { prisma, type CapabilityGrant, type Project, type WorkspaceMembership } from "@foundry/db";
import { hasCapability, type Capability, type WorkspaceRole } from "@foundry/domain";

type MembershipWithGrants = WorkspaceMembership & { grants: CapabilityGrant[] };

export type WorkspaceAccess = {
  membership: MembershipWithGrants;
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
  return assertMembershipCapability(membership, capability, projectId);
}

function assertMembershipCapability(
  membership: MembershipWithGrants | null,
  capability: Capability,
  projectId?: string,
): WorkspaceAccess {
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
  // One round trip instead of two: the membership is resolved through the
  // project's workspace in parallel, then pinned to that workspace below.
  const [project, membership] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId } }),
    prisma.workspaceMembership.findFirst({
      where: { userId, workspace: { projects: { some: { id: projectId } } } },
      include: { grants: true },
    }),
  ]);
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  const access = assertMembershipCapability(
    membership?.workspaceId === project.workspaceId ? membership : null,
    capability,
    project.id,
  );
  return { ...access, project };
}
