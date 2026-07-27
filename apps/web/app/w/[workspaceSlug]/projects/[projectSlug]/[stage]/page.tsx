import { notFound, redirect } from "next/navigation";
import { prisma } from "@foundry/db";
import {
  hasCapability,
  STAGES,
  type Capability,
  type Stage,
  type WorkspaceRole,
} from "@foundry/domain";
import { getCurrentUser } from "@/server/session";
import { IdeateStage } from "@/components/stages/ideate-stage";
import { EngineerStage } from "@/components/stages/engineer-stage";
import { VerifyStage } from "@/components/stages/verify-stage";
import { LaunchStage } from "@/components/stages/launch-stage";

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

  const engineerViews = ["sourcing", "schematic", "pcb", "model", "code", "design"] as const;
  const engineerView = engineerViews.includes(view as (typeof engineerViews)[number])
    ? (view as (typeof engineerViews)[number])
    : "schematic";

  // Engineer is a full-bleed editing surface (Figma-like); other stages are
  // centered documents.
  return (
    <div className={stage === "ENGINEER" ? "h-full" : "mx-auto w-full max-w-4xl p-6 lg:p-8"}>
      {stage === "IDEATE" ? (
        <>
          <h1 className="mb-6 text-3xl font-semibold tracking-tight">Ideate</h1>
          <IdeateStage projectId={project.id} branchId={branchId} canEdit={can("ideate.edit")} />
        </>
      ) : null}
      {stage === "ENGINEER" ? (
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
        />
      ) : null}
      {stage === "VERIFY" ? (
        <>
          <h1 className="mb-6 text-3xl font-semibold tracking-tight">Verify</h1>
          <VerifyStage
            projectId={project.id}
            branchId={branchId}
            canRun={can("verification.run")}
            canApprove={can("verification.approve")}
            verifyStatus={verifyState?.status ?? "NOT_STARTED"}
          />
        </>
      ) : null}
      {stage === "LAUNCH" ? (
        <>
          <h1 className="mb-6 text-3xl font-semibold tracking-tight">Launch</h1>
          <LaunchStage
            projectId={project.id}
            branchId={branchId}
            canCreate={can("release.create")}
            verifyApproved={verifyState?.status === "APPROVED"}
          />
        </>
      ) : null}
    </div>
  );
}
