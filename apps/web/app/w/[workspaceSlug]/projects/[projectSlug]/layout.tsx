import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { UIMessage } from "ai";
import { prisma } from "@foundry/db";
import type { Stage } from "@foundry/domain";
import { getCurrentUser } from "@/server/session";
import { ProjectShell } from "@/components/project-shell";

export default async function ProjectShellLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=/w/${workspaceSlug}/projects/${projectSlug}/overview`);

  const [workspace, memberships] = await Promise.all([
    prisma.workspace.findFirst({
      where: { slug: workspaceSlug, memberships: { some: { userId: user.id } } },
    }),
    prisma.workspaceMembership.findMany({
      where: { userId: user.id },
      include: { workspace: true },
      orderBy: { workspace: { name: "asc" } },
    }),
  ]);
  if (!workspace) notFound();

  const project = await prisma.project.findUnique({
    where: { workspaceId_slug: { workspaceId: workspace.id, slug: projectSlug } },
    include: { branches: true, stageStates: true },
  });
  if (!project) notFound();

  const activeBranch =
    project.branches.find((b) => b.id === project.activeBranchId) ?? project.branches[0];
  if (!activeBranch) notFound();

  const chatRows = await prisma.chatMessage.findMany({
    where: { projectId: project.id, branchId: activeBranch.id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const stageStatuses = Object.fromEntries(
    project.stageStates
      .filter((s) => s.branchId === activeBranch.id)
      .map((s) => [s.stage, s.status]),
  ) as Record<Stage, string>;

  return (
    <ProjectShell
      workspaces={memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
      }))}
      workspace={{ id: workspace.id, name: workspace.name, slug: workspace.slug }}
      project={{ id: project.id, name: project.name, slug: project.slug }}
      branchId={activeBranch.id}
      branchName={activeBranch.name}
      stageStatuses={stageStatuses}
      user={{ id: user.id, name: user.name }}
      initialChatMessages={chatRows.map(
        (row, i) =>
          ({
            id: row.id ?? String(i),
            role: row.role as UIMessage["role"],
            parts: row.parts as unknown as UIMessage["parts"],
          }) satisfies UIMessage,
      )}
    >
      {children}
    </ProjectShell>
  );
}
