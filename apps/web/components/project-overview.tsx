"use client";

/**
 * The project's landing page — a snapshot of all four stages plus what needs
 * attention (open proposals, stale nodes, failing checks), each linking
 * straight into the surface that explains it. Every number here is read from
 * a query some other panel already uses (verify.listChecks, graph.listProposals,
 * graph.staleNodes) — Overview composes, it doesn't re-derive.
 */

import Link from "next/link";
import { useState } from "react";
import { STAGES, STAGE_LABELS, type Stage } from "@foundry/domain";
import { STAGE_THEME } from "@/lib/stage-theme";
import { ProposalInboxOverlay } from "@/components/graph/proposal-inbox";
import { StatusBadge } from "@/components/status-badge";
import { STAGE_VIEW } from "@/components/stage-rail";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

function timeAgo(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** "ComponentCreated" -> "component created" */
function humanizeEventType(type: string): string {
  return type.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

export function ProjectOverview({
  projectId,
  branchId,
  basePath,
  stageStatuses,
}: {
  projectId: string;
  branchId: string;
  basePath: string;
  stageStatuses: Record<Stage, string>;
}) {
  const [inboxOpen, setInboxOpen] = useState(false);
  const checks = trpc.verify.listChecks.useQuery({ projectId, branchId });
  const proposals = trpc.graph.listProposals.useQuery({ projectId, branchId, status: "PENDING" });
  const stale = trpc.graph.staleNodes.useQuery({ projectId, branchId });
  const activity = trpc.project.recentActivity.useQuery({ projectId });

  const checksList = checks.data ?? [];
  const checksPassed = checksList.filter((c) => c.status === "PASS").length;
  const checksFailed = checksList.filter((c) => c.status === "FAIL").length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 lg:p-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          One page for where this product stands — every number links to the surface that explains
          it.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STAGES.map((stage) => {
          const theme = STAGE_THEME[stage];
          const status = stageStatuses[stage] ?? "NOT_STARTED";
          return (
            <Link
              key={stage}
              href={`${basePath}/engineer?view=${STAGE_VIEW[stage]}`}
              className="border-border hover:bg-muted/40 flex flex-col gap-2 rounded-none border p-3 transition-colors"
            >
              <span className={cn("size-2 rounded-full", theme.rail)} aria-hidden />
              <span className="text-sm font-medium">{STAGE_LABELS[stage]}</span>
              <StatusBadge status={status} className="self-start" />
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href={`${basePath}/engineer?view=verify`}
          className="border-border hover:bg-muted/40 flex flex-col gap-1 rounded-none border p-3 transition-colors"
        >
          <span className="text-muted-foreground text-xs uppercase tracking-wide">Checks</span>
          {checks.isLoading ? (
            <Skeleton className="h-6 w-16" />
          ) : (
            <span className="text-lg font-semibold">
              {checksPassed}/{checksList.length}
              {checksFailed > 0 ? (
                <span className="text-destructive ml-2 text-xs font-normal">
                  {checksFailed} failing
                </span>
              ) : null}
            </span>
          )}
        </Link>
        <Link
          href={`${basePath}/engineer?view=checks`}
          className="border-border hover:bg-muted/40 flex flex-col gap-1 rounded-none border p-3 transition-colors"
        >
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            Needs another look
          </span>
          {stale.isLoading ? (
            <Skeleton className="h-6 w-10" />
          ) : (
            <span className="text-lg font-semibold">{stale.data?.length ?? 0}</span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setInboxOpen(true)}
          className="border-border hover:bg-muted/40 flex flex-col gap-1 rounded-none border p-3 text-left transition-colors"
        >
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            Pending proposals
          </span>
          {proposals.isLoading ? (
            <Skeleton className="h-6 w-10" />
          ) : (
            <span className="text-lg font-semibold">{proposals.data?.length ?? 0}</span>
          )}
        </button>
      </div>
      {inboxOpen ? (
        <ProposalInboxOverlay
          projectId={projectId}
          branchId={branchId}
          onClose={() => setInboxOpen(false)}
        />
      ) : null}

      <div className="border-border rounded-none border">
        <div className="border-border border-b px-3 py-2">
          <h2 className="text-sm font-medium">Recent activity</h2>
        </div>
        <div className="flex flex-col divide-y">
          {activity.isLoading ? (
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-4 w-full max-w-sm" />
              <Skeleton className="h-4 w-full max-w-xs" />
              <Skeleton className="h-4 w-full max-w-md" />
            </div>
          ) : !activity.data?.length ? (
            <p className="text-muted-foreground p-3 text-sm">No activity yet.</p>
          ) : (
            activity.data.map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-sm">
                  <span className="font-medium">{event.actorName}</span>{" "}
                  <span className="text-muted-foreground">{humanizeEventType(event.type)}</span>
                </span>
                <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                  {timeAgo(new Date(event.createdAt))}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
