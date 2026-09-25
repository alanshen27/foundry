"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { STAGE_LABELS, STAGES, type Stage } from "@foundry/domain";
import { STAGE_THEME } from "@/lib/stage-theme";
import { cn } from "@/lib/utils";

/** Status dot colors, reusing the same semantic palette as status-badge.tsx. */
const STAGE_DOT_COLOR: Record<string, string> = {
  NOT_STARTED: "bg-muted-foreground/30",
  DRAFT: "bg-sky-500",
  RUNNING: "bg-primary",
  NEEDS_REVIEW: "bg-amber-500",
  APPROVED: "bg-emerald-500",
  BLOCKED: "bg-red-500",
  STALE: "bg-orange-500",
};

/** The `?view=` each stage opens on. */
export const STAGE_VIEW: Record<Stage, string> = {
  IDEATE: "ideate",
  ENGINEER: "assembly",
  VERIFY: "verify",
  LAUNCH: "launch",
};

/** Which stage a `?view=` param belongs to — mirrors engineer-tabs.ts's grouping. */
function stageForView(view: string | null): Stage {
  if (view === "ideate") return "IDEATE";
  if (view === "verify") return "VERIFY";
  if (view === "launch" || view === "renders") return "LAUNCH";
  return "ENGINEER";
}

export function StageRail({
  basePath,
  stageStatuses,
}: {
  basePath: string;
  stageStatuses: Record<Stage, string>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isOverview = Boolean(pathname?.endsWith("/overview"));
  const activeStage = isOverview ? null : stageForView(searchParams.get("view"));

  return (
    <nav aria-label="Pipeline stage" className="flex h-full shrink-0 items-center gap-0.5">
      <Link
        href={`${basePath}/overview`}
        aria-current={isOverview ? "page" : undefined}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-none px-2 text-[12px] font-medium transition-colors",
          isOverview
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        Overview
      </Link>
      <span className="bg-border mx-1 h-4 w-px shrink-0" aria-hidden />
      {STAGES.map((stage) => {
        const theme = STAGE_THEME[stage];
        const active = activeStage === stage;
        const status = stageStatuses[stage] ?? "NOT_STARTED";
        return (
          <Link
            key={stage}
            href={`${basePath}/engineer?view=${STAGE_VIEW[stage]}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-none px-2 text-[12px] font-medium transition-colors",
              active ? theme.active : cn("text-muted-foreground hover:bg-muted/50", theme.idleIcon),
            )}
          >
            <span
              className={cn("size-1.5 shrink-0 rounded-full", STAGE_DOT_COLOR[status])}
              aria-hidden
            />
            {STAGE_LABELS[stage]}
          </Link>
        );
      })}
    </nav>
  );
}
