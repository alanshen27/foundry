import { notFound, redirect } from "next/navigation";
import { prisma } from "@foundry/db";
import { hasCapability, type Capability, type WorkspaceRole } from "@foundry/domain";
import { HomeShell } from "@/components/home-shell";
import { SitesPanel } from "@/components/sites/sites-panel";
import { getCurrentUser } from "@/server/session";

/**
 * Workspace storefront sites. Generation, preview hosting, and deployment
 * are owned by the site builder behind SiteBuilderPort.
 */
export default async function WorkspaceSitesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=/w/${workspaceSlug}/sites`);

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

  const membership = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    include: { grants: true },
  });
  if (!membership) notFound();
  const role = membership.role as WorkspaceRole;
  const grants = membership.grants
    .filter((g) => g.projectId === null)
    .map((g) => g.capability as Capability);

  return (
    <HomeShell
      workspaces={memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
      }))}
      current={{ id: workspace.id, name: workspace.name, slug: workspace.slug }}
      projects={workspace.projects}
      folders={workspace.folders}
      user={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }}
    >
      <div className="mb-8">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Sites</h1>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Storefronts and product pages for {workspace.name}
        </p>
      </div>

      <SitesPanel
        workspaceId={workspace.id}
        projects={workspace.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug }))}
        canEdit={hasCapability(role, grants, "site.edit")}
        canPublish={hasCapability(role, grants, "site.publish")}
      />
    </HomeShell>
  );
}
