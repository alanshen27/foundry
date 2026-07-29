import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Users } from "lucide-react";
import { prisma } from "@foundry/db";
import { HomeShell } from "@/components/home-shell";
import { SignalIconTile } from "@/components/signal-icons";
import { Card } from "@/components/ui/card";
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

  // Default home, or backfill if memberships are somehow empty.
  if (manage !== "1" || workspaces.length === 0) {
    redirect(await resolveWorkspaceHomePath(user.id));
  }

  const current = {
    id: workspaces[0]!.id,
    name: workspaces[0]!.name,
    slug: workspaces[0]!.slug,
  };

  return (
    <HomeShell
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug }))}
      current={current}
      projects={workspaces[0]?.projects ?? []}
      folders={workspaces[0]?.folders ?? []}
      user={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }}
    >
      <div className="mb-8">
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
          Manage
        </p>
        <h1 className="mt-1 font-mono text-[28px] font-medium tracking-[-0.04em]">Workspaces</h1>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Create or switch workspaces. Day-to-day work lives inside a single workspace home.
        </p>
      </div>

      <section className="mb-10 grid gap-2 sm:grid-cols-2">
        {workspaces.map((workspace) => (
          <Link key={workspace.id} href={`/w/${workspace.slug}`} className="block">
            <Card className="flex-row gap-0 py-0 transition-colors hover:ring-foreground/30">
              <SignalIconTile
                kind="workspace"
                seed={workspace.id}
                letter={workspace.name}
                className="h-auto w-[5.5rem] self-stretch sm:w-28"
              />
              <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px] font-medium tracking-[-0.02em]">
                    {workspace.name}
                  </p>
                  <p className="text-muted-foreground mt-0.5 font-mono text-[10px] tracking-[0.06em] uppercase">
                    {workspace._count.projects} project
                    {workspace._count.projects === 1 ? "" : "s"}
                    {" · "}
                    <Users className="mr-0.5 inline size-2.5" strokeWidth={1.75} />
                    {workspace._count.memberships}
                  </p>
                </div>
                <ArrowUpRight className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover/card:opacity-100" />
              </div>
            </Card>
          </Link>
        ))}
      </section>

      <CreateWorkspaceForm />
    </HomeShell>
  );
}
