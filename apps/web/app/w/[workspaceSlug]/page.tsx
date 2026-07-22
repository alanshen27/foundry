import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@foundry/db";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { HomeShell } from "@/components/home-shell";
import { getCurrentUser } from "@/server/session";
import { CreateProjectForm } from "./create-project-form";

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
          include: { stageStates: true },
          orderBy: { createdAt: "asc" },
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
      userName={user.name}
    >
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">{workspace.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {workspace.projects.length} active project{workspace.projects.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="mb-8 grid gap-3">
        {workspace.projects.map((project) => (
          <Link key={project.id} href={`/w/${workspace.slug}/projects/${project.slug}/overview`}>
            <Card className="hover:border-primary/40 p-4 transition-colors">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{project.name}</p>
                  {project.description ? (
                    <p className="text-muted-foreground text-sm">{project.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {(["IDEATE", "ENGINEER", "VERIFY", "LAUNCH"] as const).map((stage) => {
                    const state = project.stageStates.find((s) => s.stage === stage);
                    return (
                      <span key={stage} title={`${stage}: ${state?.status ?? "NOT_STARTED"}`}>
                        <StatusBadge status={state?.status ?? "NOT_STARTED"} />
                      </span>
                    );
                  })}
                </div>
              </div>
            </Card>
          </Link>
        ))}
        {workspace.projects.length === 0 ? (
          <p className="text-muted-foreground text-sm">No projects yet.</p>
        ) : null}
      </div>

      <CreateProjectForm workspaceId={workspace.id} workspaceSlug={workspace.slug} />
    </HomeShell>
  );
}
