import { notFound, redirect } from "next/navigation";
import { Globe } from "lucide-react";
import { prisma } from "@foundry/db";
import { HomeShell } from "@/components/home-shell";
import { getCurrentUser } from "@/server/session";

/**
 * Workspace storefront sites. Launch/commerce is not implemented yet —
 * this route exists so the sidebar Sites tab has a real destination.
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

      <div className="bg-card flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
        <span className="bg-muted text-muted-foreground mb-3 flex size-10 items-center justify-center rounded-lg">
          <Globe className="size-4" strokeWidth={1.75} />
        </span>
        <p className="text-[13px] font-medium">No sites yet</p>
        <p className="text-muted-foreground mt-1 max-w-sm text-[13px]">
          Storefront builder ships with Launch. This tab is ready — site creation is not
          implemented yet.
        </p>
      </div>
    </HomeShell>
  );
}
