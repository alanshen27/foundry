import { notFound, redirect } from "next/navigation";
import { prisma } from "@foundry/db";
import type { Stage } from "@foundry/domain";
import { getCurrentUser } from "@/server/session";
import { ProjectOverview } from "@/components/project-overview";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/auth/sign-in?next=/w/${workspaceSlug}/projects/${projectSlug}/overview`);
  }

  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug } },
    include: { stageStates: true },
  });
  if (!project?.activeBranchId) notFound();
  const branchId = project.activeBranchId;

  const stageStatuses = Object.fromEntries(
    project.stageStates.filter((s) => s.branchId === branchId).map((s) => [s.stage, s.status]),
  ) as Record<Stage, string>;

  return (
    <ProjectOverview
      projectId={project.id}
      branchId={branchId}
      basePath={`/w/${workspaceSlug}/projects/${projectSlug}`}
      stageStatuses={stageStatuses}
    />
  );
}
