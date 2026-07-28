import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Combine, Cpu, Lightbulb, Rocket, ShieldCheck } from "lucide-react";
import { prisma } from "@foundry/db";
import { STAGE_LABELS, STAGES, type Stage } from "@foundry/domain";
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
  ENGINEER: "Assembly, CAD, circuit, PCB",
  VERIFY: "Validation checklist",
  LAUNCH: "Immutable releases",
};

const STAGE_CODES: Record<Stage, string> = {
  IDEATE: "01",
  ENGINEER: "02",
  VERIFY: "03",
  LAUNCH: "04",
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
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
          Project
        </p>
        <h1 className="mt-1 font-mono text-[28px] font-medium tracking-[-0.04em]">
          {project.name}
        </h1>
        {project.description ? (
          <p className="text-muted-foreground mt-1.5 text-[14px]">{project.description}</p>
        ) : null}
      </div>

      <PipelineKickoff hasBrief={Boolean(brief?.prompt || brief?.intendedUse)} />

      <Link
        href={`${base}/engineer`}
        className="border-border bg-card hover:border-foreground/30 group flex items-center gap-4 border px-4 py-3.5 transition-colors"
      >
        <span className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center">
          <Combine className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[13px] font-medium tracking-[-0.02em]">Assembly workspace</p>
          <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
            Home viewport — CAD · Schematic · PCB as tabs
          </p>
        </div>
        <ArrowRight className="text-muted-foreground size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </Link>

      <div>
        <p className="text-muted-foreground mb-2 font-mono text-[11px] tracking-[0.14em] uppercase">
          Process — Engineer opens assembly
        </p>
        <div className="border-border bg-border grid grid-cols-2 gap-px border xl:grid-cols-4">
          {STAGES.map((stage) => {
            const state = project.stageStates.find(
              (s) => s.stage === stage && s.branchId === project.activeBranchId,
            );
            const Icon = STAGE_ICONS[stage];
            const phase = STAGE_THEME[stage];
            return (
              <Link
                key={stage}
                href={`${base}/${stage.toLowerCase()}`}
                className={cn(
                  "bg-card group flex flex-col gap-3 p-4 transition-colors",
                  phase.cardHover,
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground font-mono text-[10px] tracking-[0.12em]">
                    {STAGE_CODES[stage]}
                  </span>
                  <StatusBadge
                    status={state?.status ?? "NOT_STARTED"}
                    className="rounded-none font-mono text-[10px] tracking-[0.04em]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Icon className={cn("size-3.5", phase.text)} strokeWidth={1.75} />
                  <p className="font-mono text-[13px] font-medium tracking-[-0.02em]">
                    {STAGE_LABELS[stage]}
                  </p>
                </div>
                <p className="text-muted-foreground font-mono text-[11px]">
                  {stageCounts[stage] > 0
                    ? `${stageCounts[stage]} item${stageCounts[stage] === 1 ? "" : "s"}`
                    : STAGE_BLURBS[stage]}
                </p>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="border-border bg-card border">
        <div className="border-border border-b px-4 py-2.5">
          <h2 className="text-muted-foreground font-mono text-[11px] font-medium tracking-[0.14em] uppercase">
            Activity
          </h2>
        </div>
        {recentEvents.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 font-mono text-[12px]">No activity yet.</p>
        ) : (
          <ul className="divide-border divide-y">
            {recentEvents.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
              >
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">
                    {event.actorType === "AGENT"
                      ? "Copilot (as " + event.actor.name + ")"
                      : event.actor.name}
                  </span>{" "}
                  · {event.type.replace(/([a-z])([A-Z])/g, "$1 $2")}
                </span>
                <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                  {event.createdAt.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
