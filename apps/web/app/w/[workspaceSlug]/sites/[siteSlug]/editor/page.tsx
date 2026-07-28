import { notFound, redirect } from "next/navigation";
import { prisma } from "@foundry/db";
import { hasCapability, type Capability, type WorkspaceRole } from "@foundry/domain";
import { HomeShell } from "@/components/home-shell";
import { SiteEditorWorkspace } from "@/components/sites/site-editor-workspace";
import { getCurrentUser } from "@/server/session";

export default async function SiteEditorPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; siteSlug: string }>;
}) {
  const { workspaceSlug, siteSlug } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/auth/sign-in?next=/w/${workspaceSlug}/sites/${encodeURIComponent(siteSlug)}/editor`);
  }

  const [workspace, memberships] = await Promise.all([
    prisma.workspace.findFirst({
      where: { slug: workspaceSlug, memberships: { some: { userId: user.id } } },
      include: {
        projects: {
          where: { status: "ACTIVE" },
          select: { id: true, name: true, slug: true, folderId: true },
          orderBy: { createdAt: "asc" },
        },
        folders: {
          select: { id: true, name: true, parentId: true, sortOrder: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    }),
    prisma.workspaceMembership.findMany({
      where: { userId: user.id },
      include: { workspace: true },
      orderBy: { workspace: { name: "asc" } },
    }),
  ]);
  if (!workspace) notFound();

  const [membership, site] = await Promise.all([
    prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      include: { grants: true },
    }),
    prisma.site.findUnique({
      where: { workspaceId_slug: { workspaceId: workspace.id, slug: siteSlug } },
      select: { id: true, name: true, slug: true, projectId: true },
    }),
  ]);
  if (!membership || !site) notFound();

  const role = membership.role as WorkspaceRole;
  const grants = membership.grants
    .filter((grant) => grant.projectId === null || grant.projectId === site.projectId)
    .map((grant) => grant.capability as Capability);

  return (
    <HomeShell
      workspaces={memberships.map((item) => ({
        id: item.workspace.id,
        name: item.workspace.name,
        slug: item.workspace.slug,
      }))}
      current={{ id: workspace.id, name: workspace.name, slug: workspace.slug }}
      projects={workspace.projects}
      folders={workspace.folders}
      user={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }}
      contentClassName="overflow-hidden p-0"
    >
      <SiteEditorWorkspace
        siteId={site.id}
        siteName={site.name}
        siteSlug={site.slug}
        workspaceSlug={workspace.slug}
        canEdit={hasCapability(role, grants, "site.edit")}
        canPublish={hasCapability(role, grants, "site.publish")}
        canManageCommerce={hasCapability(role, grants, "commerce.manage")}
      />
    </HomeShell>
  );
}
