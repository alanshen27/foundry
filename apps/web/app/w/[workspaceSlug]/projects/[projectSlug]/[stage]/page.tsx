import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { prisma } from "@foundry/db";
import {
  hasCapability,
  STAGES,
  type Capability,
  type Stage,
  type WorkspaceRole,
} from "@foundry/domain";
import { getCurrentUser } from "@/server/session";
import { EngineerStage, type EngineerView } from "@/components/stages/engineer-stage";

export default async function StagePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string; stage: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { workspaceSlug, projectSlug, stage: stageParam } = await params;
  const { view } = await searchParams;
  const stage = stageParam.toUpperCase() as Stage;
  if (!STAGES.includes(stage)) notFound();

  // Single-window workspace: every stage is a tab inside Engineer now, so
  // legacy stage routes redirect into the one surface.
  const base = `/w/${workspaceSlug}/projects/${projectSlug}/engineer`;
  if (stage === "IDEATE") redirect(`${base}?view=ideate`);
  if (stage === "VERIFY") redirect(`${base}?view=verify`);
  if (stage === "LAUNCH") redirect(`${base}?view=${view === "renders" ? "renders" : "launch"}`);

  const user = await getCurrentUser();
  if (!user) {
    redirect(
      `/auth/sign-in?next=/w/${workspaceSlug}/projects/${projectSlug}/${stageParam.toLowerCase()}`,
    );
  }

  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug } },
    include: { stageStates: true },
  });
  if (!project?.activeBranchId) notFound();
  const branchId = project.activeBranchId;

  const membership = await prisma.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: project.workspaceId, userId: user.id } },
    include: { grants: true },
  });
  if (!membership) notFound();
  const role = membership.role as WorkspaceRole;
  const grants = membership.grants
    .filter((g) => g.projectId === null || g.projectId === project.id)
    .map((g) => g.capability as Capability);
  const can = (capability: Capability) => hasCapability(role, grants, capability);

  const verifyState = project.stageStates.find(
    (s) => s.stage === "VERIFY" && s.branchId === branchId,
  );

  const engineerViews = [
    "sourcing",
    "schematic",
    "pcb",
    "model",
    "code",
    "design",
    "assembly",
    "checks",
    "ideate",
    "verify",
    "launch",
    "renders",
  ] as const;
  const engineerView: EngineerView = engineerViews.includes(view as (typeof engineerViews)[number])
    ? (view as (typeof engineerViews)[number])
    : "assembly";

  return (
    <div className="h-full">
      <Suspense fallback={<div className="bg-muted/30 h-full" />}>
        <EngineerStage
          projectId={project.id}
          branchId={branchId}
          view={engineerView}
          canEdit={
            can("electronics.edit") ||
            can("mechanical.edit") ||
            can("software.edit") ||
            can("site.edit")
          }
          caps={{
            canEditIdeate: can("ideate.edit"),
            canRunVerify: can("verification.run"),
            canApproveVerify: can("verification.approve"),
            canCreateRelease: can("release.create"),
            canEditMedia: can("site.edit"),
            canApproveMedia: can("site.publish"),
            verifyStatus: verifyState?.status ?? "NOT_STARTED",
          }}
        />
      </Suspense>
    </div>
  );
}
