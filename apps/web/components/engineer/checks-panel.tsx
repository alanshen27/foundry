"use client";

/**
 * Verify lens inside the Engineer workbench: the branch's validation checks
 * grouped by the part/file they target, without leaving the viewport. Full
 * check management (statuses, waivers, approval) stays on the Verify stage.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { BLOCKING_CHECK_STATUSES, groupChecksByTarget } from "@/lib/verify-checks";

type Props = {
  projectId: string;
  branchId: string;
};

export function ChecksPanel({ projectId, branchId }: Props) {
  const pathname = usePathname();
  const verifyHref = pathname?.replace(/\/engineer.*$/, "/verify") ?? "";
  const list = trpc.verify.listChecks.useQuery({ projectId, branchId });

  if (list.isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading checks">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-4 w-64" />
      </div>
    );
  }

  const checks = list.data ?? [];
  const groups = groupChecksByTarget(checks);
  const passed = checks.filter((c) => c.status === "PASS").length;
  const blocking = checks.filter((c) => !c.waived && BLOCKING_CHECK_STATUSES.has(c.status)).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-muted-foreground size-4" strokeWidth={1.75} />
            <span className="text-sm font-medium">Validation checks</span>
            <span className="text-muted-foreground text-xs">
              {passed}/{checks.length} passing · {blocking} blocking
            </span>
          </div>
          <Link
            href={verifyHref}
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
          >
            Manage in Verify
          </Link>
        </div>

        {checks.length === 0 ? (
          <EmptyState title="No checks defined">
            Add validation checks on the Verify stage to gate the release.
          </EmptyState>
        ) : (
          groups.map((group) => (
            <section key={group.target ?? "__project"} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-mono text-[11px] tracking-wide">
                  {group.target ?? "Project-wide"}
                </span>
                {group.blocking > 0 ? (
                  <span className="text-destructive text-[11px]">{group.blocking} blocking</span>
                ) : null}
              </div>
              <ul className="divide-border divide-y border">
                {group.checks.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p
                        className={
                          c.waived
                            ? "text-sm font-medium line-through opacity-70"
                            : "text-sm font-medium"
                        }
                      >
                        {c.title}
                      </p>
                      {c.detail ? (
                        <p className="text-muted-foreground truncate text-xs">{c.detail}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <StatusBadge status={c.severity} />
                      <StatusBadge status={c.status} />
                      {c.waived ? <StatusBadge status="SKIPPED" className="italic" /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
