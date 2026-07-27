import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Combine, Cpu, Lightbulb, Rocket, ShieldCheck } from "lucide-react";
import { prisma } from "@foundry/db";
import { STAGE_LABELS, STAGES, type Stage } from "@foundry/domain";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { STAGE_THEME } from "@/lib/stage-theme";
import { cn } from "@/lib/utils";
import { PipelineKickoff } from "./pipeline-kickoff";

const STAGE_ICONS: Record<Stage, typeof Lightbulb> = {
  IDEATE: Lightbulb,
  ENGINEER: Cpu,
  VERIFY: ShieldCheck,
  LAUNCH: Rocket,
};

const STAGE_BLURBS: Record<Stage, string> = {
  IDEATE: "Brief & requirements",
  ENGINEER: "Circuit, model, code, BOM",
  VERIFY: "Validation checklist",
  LAUNCH: "Immutable releases",
};

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug } },
    include: { stageStates: true },
  });
  if (!project?.activeBranchId) notFound();

  const [brief, recentEvents, counts] = await Promise.all([
    prisma.projectBrief.findUnique({
      where: {
        projectId_branchId: { projectId: project.id, branchId: project.activeBranchId },
      },
    }),
    prisma.auditEvent.findMany({
      where: { projectId: project.id },
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    Promise.all([
      prisma.requirement.count({ where: { projectId: project.id } }),
      prisma.component.count({ where: { projectId: project.id } }),
      prisma.validationCheck.count({ where: { projectId: project.id } }),
      prisma.release.count({ where: { projectId: project.id } }),
    ]),
  ]);
  const [reqCount, compCount, checkCount, releaseCount] = counts;
  const stageCounts: Record<Stage, number> = {
    IDEATE: reqCount,
    ENGINEER: compCount,
    VERIFY: checkCount,
    LAUNCH: releaseCount,
  };

  const base = `/w/${workspaceSlug}/projects/${projectSlug}`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6 lg:p-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
        {project.description ? (
          <p className="text-muted-foreground mt-1.5">{project.description}</p>
        ) : null}
      </div>

      <PipelineKickoff hasBrief={Boolean(brief?.prompt || brief?.intendedUse)} />

      <Link href={`${base}/engineer?view=assembly`}>
        <Card className="group flex-row items-center gap-4 p-5 transition-colors hover:border-primary/40">
          <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
            <Combine className="size-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Final assembly</p>
            <p className="text-muted-foreground text-sm">
              The whole product in one scene — enclosure, parts and PCB together, with links into
              every editor.
            </p>
          </div>
          <ArrowRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </Card>
      </Link>

      <div>
        <p className="text-muted-foreground mb-2 text-xs">
          Work in any order — every surface feeds the final assembly.
        </p>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {STAGES.map((stage) => {
            const state = project.stageStates.find(
              (s) => s.stage === stage && s.branchId === project.activeBranchId,
            );
            const Icon = STAGE_ICONS[stage];
            const phase = STAGE_THEME[stage];
            return (
              <Link key={stage} href={`${base}/${stage.toLowerCase()}`}>
                <Card className={cn("group h-full gap-3 p-4 transition-colors", phase.cardHover)}>
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg",
                        phase.tile,
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <StatusBadge status={state?.status ?? "NOT_STARTED"} />
                  </div>
                  <div>
                    <p className="font-medium">{STAGE_LABELS[stage]}</p>
                    <p className="text-muted-foreground text-xs">
                      {stageCounts[stage] > 0
                        ? `${stageCounts[stage]} item${stageCounts[stage] === 1 ? "" : "s"}`
                        : STAGE_BLURBS[stage]}
                    </p>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      <Card className="p-5">
        <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-widest uppercase">
          Activity
        </h2>
        {recentEvents.length === 0 ? (
          <p className="text-muted-foreground text-sm">No activity yet.</p>
        ) : (
          <ul className="divide-border/60 divide-y">
            {recentEvents.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">
                    {event.actorType === "AGENT"
                      ? "Copilot (as " + event.actor.name + ")"
                      : event.actor.name}
                  </span>{" "}
                  · {event.type.replace(/([a-z])([A-Z])/g, "$1 $2")}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {event.createdAt.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
