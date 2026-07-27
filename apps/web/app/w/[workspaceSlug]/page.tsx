import { notFound, redirect } from "next/navigation";
import { prisma } from "@foundry/db";
import { HomeShell } from "@/components/home-shell";
import { WorkspaceFolderBrowser } from "@/components/workspace-folder-browser";
import { projectPreview } from "@/lib/project-preview";
import { getCurrentUser } from "@/server/session";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=/w/${workspaceSlug}`);

  const [workspace, memberships] = await Promise.all([
    prisma.workspace.findFirst({
      where: { slug: workspaceSlug, memberships: { some: { userId: user.id } } },
      include: {
        projects: {
          where: { status: "ACTIVE" },
          include: {
            stageStates: true,
            designDocs: {
              where: { kind: "MODEL3D" },
              select: { branchId: true, updatedAt: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        folders: {
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

  return (
    <HomeShell
      workspaces={memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
      }))}
      current={{ id: workspace.id, name: workspace.name, slug: workspace.slug }}
      projects={workspace.projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        folderId: p.folderId,
      }))}
      folders={workspace.folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        sortOrder: f.sortOrder,
        color: f.color,
      }))}
      user={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }}
    >
      <WorkspaceFolderBrowser
        workspaceId={workspace.id}
        workspaceSlug={workspace.slug}
        workspaceName={workspace.name}
        folderId={null}
        folders={workspace.folders.map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId,
          sortOrder: f.sortOrder,
          color: f.color,
        }))}
        projects={workspace.projects.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          description: p.description,
          folderId: p.folderId,
          stageStates: p.stageStates.map((s) => ({ stage: s.stage, status: s.status })),
          ...projectPreview(p),
        }))}
      />
    </HomeShell>
  );
}
