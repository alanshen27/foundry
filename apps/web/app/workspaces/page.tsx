import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@foundry/db";
import { Card } from "@/components/ui/card";
import { HomeShell } from "@/components/home-shell";
import { getCurrentUser } from "@/server/session";
import { CreateWorkspaceForm } from "./create-workspace-form";

export default async function WorkspacesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=/workspaces");

  const workspaces = await prisma.workspace.findMany({
    where: { memberships: { some: { userId: user.id } } },
    include: { _count: { select: { projects: true, memberships: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <HomeShell
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug }))}
      userName={user.name}
    >
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Workspaces</h1>
        <p className="text-muted-foreground mt-1 text-sm">Signed in as {user.email}</p>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        {workspaces.map((workspace) => (
          <Link key={workspace.id} href={`/w/${workspace.slug}`}>
            <Card className="hover:border-primary/40 h-full gap-2 p-4 transition-colors">
              <p className="font-medium">{workspace.name}</p>
              <p className="text-muted-foreground text-sm">
                {workspace._count.projects} projects · {workspace._count.memberships} members
              </p>
            </Card>
          </Link>
        ))}
        {workspaces.length === 0 ? (
          <p className="text-muted-foreground text-sm">No workspaces yet. Create one below.</p>
        ) : null}
      </div>

      <CreateWorkspaceForm />
    </HomeShell>
  );
}
