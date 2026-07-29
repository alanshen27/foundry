import type { WorkspaceRole } from "@foundry/domain";

/** Membership row shape needed to derive the shared list (see workspace router). */
export type SharedMembership = {
  role: WorkspaceRole;
  grants: { projectId: string | null }[];
  workspace: {
    id: string;
    name: string;
    slug: string;
    createdBy: { name: string };
    projects: { id: string; name: string; slug: string }[];
  };
};

export type SharedProject = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  ownerName: string;
};

/**
 * Flattens memberships in other people's workspaces into a single project
 * list. Shared work carries no folder hierarchy: the folders belong to the
 * owning workspace, so the sidebar lists these projects directly.
 */
export function selectSharedProjects(memberships: SharedMembership[]): SharedProject[] {
  const shared = memberships.flatMap((membership) => {
    // A guest invited from one project holds a project-scoped grant and must
    // only see that project, not the whole workspace.
    const granted = new Set(
      membership.grants.map((g) => g.projectId).filter((id): id is string => id !== null),
    );
    const projects =
      membership.role === "GUEST" && granted.size > 0
        ? membership.workspace.projects.filter((p) => granted.has(p.id))
        : membership.workspace.projects;

    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      role: membership.role,
      workspaceId: membership.workspace.id,
      workspaceName: membership.workspace.name,
      workspaceSlug: membership.workspace.slug,
      ownerName: membership.workspace.createdBy.name,
    }));
  });

  return shared.sort(
    (a, b) => a.workspaceName.localeCompare(b.workspaceName) || a.name.localeCompare(b.name),
  );
}
