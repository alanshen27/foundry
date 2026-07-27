import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Users } from "lucide-react";
import { prisma } from "@foundry/db";
import { Card } from "@/components/ui/card";
import { HomeShell } from "@/components/home-shell";
import { getCurrentUser } from "@/server/session";
import { resolveWorkspaceHomePath } from "@/server/workspace-home";
import { CreateWorkspaceForm } from "./create-workspace-form";

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ manage?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=/workspaces?manage=1");

  const { manage } = await searchParams;
  const workspaces = await prisma.workspace.findMany({
    where: { memberships: { some: { userId: user.id } } },
    include: {
      _count: { select: { projects: true, memberships: true } },
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
    orderBy: { createdAt: "asc" },
  });

  // Default: one workspace home by slug — not the multi-workspace picker.
  if (manage !== "1" && workspaces.length > 0) {
    redirect(await resolveWorkspaceHomePath(user.id));
  }

  const current = workspaces[0]
    ? { id: workspaces[0].id, name: workspaces[0].name, slug: workspaces[0].slug }
    : undefined;

  return (
    <HomeShell
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug }))}
      current={current}
      projects={workspaces[0]?.projects ?? []}
      folders={workspaces[0]?.folders ?? []}
      user={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }}
    >
      <div className="mb-8">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Workspaces</h1>
        <p className="text-muted-foreground mt-1 text-[13px]">
          {workspaces.length === 0
            ? `Signed in as ${user.email}`
            : "Create or switch workspaces. Day-to-day work lives inside a single workspace home."}
        </p>
      </div>

      <section className="mb-10">
        {workspaces.length === 0 ? (
          <div className="bg-card mb-6 rounded-xl border border-dashed px-6 py-16 text-center">
            <p className="text-[13px] font-medium">No workspaces yet</p>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Create one below to start collaborating on hardware projects.
            </p>
          </div>
        ) : (
          <div className="mb-2 grid gap-1">
            {workspaces.map((workspace) => (
              <Link key={workspace.id} href={`/w/${workspace.slug}`} className="group">
                <Card className="hover:border-foreground/15 gap-0 rounded-lg p-0 transition-colors">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <span className="bg-muted text-foreground flex size-7 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold">
                      {workspace.name.slice(0, 1).toUpperCase()}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {workspace.name}
                    </p>
                    <span className="text-muted-foreground hidden shrink-0 text-[12px] sm:inline">
                      {workspace._count.projects} project
                      {workspace._count.projects === 1 ? "" : "s"}
                    </span>
                    <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-[12px]">
                      <Users className="size-3" strokeWidth={1.75} />
                      {workspace._count.memberships}
                    </span>
                    <ArrowUpRight className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <CreateWorkspaceForm />
    </HomeShell>
  );
}
