"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { trpc } from "@/lib/trpc";
import { selectClass } from "@/lib/format";

const CATEGORIES = ["VISUAL", "ELECTRICAL", "MECHANICAL", "SOFTWARE", "CROSS_DOMAIN"] as const;
const CHECK_STATUSES = [
  "PENDING",
  "PASS",
  "FAIL",
  "WARNING",
  "SKIPPED",
  "SIMULATED",
  "ERROR",
] as const;
const SEVERITIES = ["INFO", "MINOR", "MAJOR", "CRITICAL"] as const;
const BLOCKING = new Set(["PENDING", "FAIL", "ERROR"]);

type Props = {
  projectId: string;
  branchId: string;
  canRun: boolean;
  canApprove: boolean;
  verifyStatus: string;
};

export function VerifyStage({ projectId, branchId, canRun, canApprove, verifyStatus }: Props) {
  const router = useRouter();
  const list = trpc.verify.listChecks.useQuery({ projectId, branchId });
  const utils = trpc.useUtils();
  const invalidate = () => {
    router.refresh();
    return utils.verify.listChecks.invalidate({ projectId, branchId });
  };

  const create = trpc.verify.createCheck.useMutation({ onSuccess: invalidate });
  const update = trpc.verify.updateCheck.useMutation({ onSuccess: invalidate });
  const waive = trpc.verify.waiveCheck.useMutation({ onSuccess: invalidate });
  const remove = trpc.verify.deleteCheck.useMutation({ onSuccess: invalidate });
  const approve = trpc.verify.approve.useMutation({ onSuccess: invalidate });

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("CROSS_DOMAIN");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("INFO");
  const [waivingId, setWaivingId] = useState<string | null>(null);
  const [waiverReason, setWaiverReason] = useState("");

  const checks = list.data ?? [];
  const passed = checks.filter((c) => c.status === "PASS").length;
  const waived = checks.filter((c) => c.waived).length;
  const blocking = checks.filter((c) => !c.waived && BLOCKING.has(c.status)).length;
  const canApproveNow = checks.length > 0 && blocking === 0;

  function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate(
      { projectId, branchId, title: title.trim(), category, severity },
      { onSuccess: () => setTitle("") },
    );
  }

  function submitWaiver(id: string) {
    if (!waiverReason.trim()) return;
    waive.mutate(
      { id, waived: true, waiverReason: waiverReason.trim() },
      {
        onSuccess: () => {
          setWaivingId(null);
          setWaiverReason("");
        },
      },
    );
  }

  if (list.isLoading) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading verification">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
            <Skeleton className="h-8 w-40" />
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-44" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-8 min-w-60 flex-1" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-start justify-between gap-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-3/5" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Verification <StatusBadge status={verifyStatus} />
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              {passed}/{checks.length} passing · {waived} waived · {blocking} blocking
            </p>
          </div>
          {canApprove ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                onClick={() => approve.mutate({ projectId, branchId })}
                disabled={!canApproveNow || approve.isPending || verifyStatus === "APPROVED"}
              >
                {verifyStatus === "APPROVED"
                  ? "Approved"
                  : approve.isPending
                    ? "Approving…"
                    : "Approve verification"}
              </Button>
              {!canApproveNow && verifyStatus !== "APPROVED" ? (
                <span className="text-muted-foreground text-xs">
                  {checks.length === 0
                    ? "Add checks first"
                    : `${blocking} unresolved check(s)`}
                </span>
              ) : null}
              {approve.error ? (
                <span className="text-destructive text-xs">{approve.error.message}</span>
              ) : null}
            </div>
          ) : null}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Validation checklist</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canRun ? (
            <form onSubmit={onAdd} className="flex flex-wrap items-center gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Enclosure passes 1 m drop test"
                className="min-w-60 flex-1"
                aria-label="Check title"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
                className={selectClass}
                aria-label="Check category"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace("_", " ")}
                  </option>
                ))}
              </select>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as typeof severity)}
                className={selectClass}
                aria-label="Check severity"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={create.isPending}>
                Add check
              </Button>
            </form>
          ) : null}

          {checks.length === 0 ? (
            <EmptyState title="No checks defined">
              {canRun
                ? "Add validation checks to gate the release."
                : "Checks will appear here once defined."}
            </EmptyState>
          ) : (
            <ul className="divide-border divide-y">
              {checks.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={c.waived ? "font-medium line-through opacity-70" : "font-medium"}>
                        {c.title}
                      </p>
                      {c.detail ? (
                        <p className="text-muted-foreground text-sm">{c.detail}</p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={c.category.replace("_", " ")} />
                        <StatusBadge status={c.severity} />
                        <StatusBadge status={c.status} />
                        {c.waived ? <StatusBadge status="SKIPPED" className="italic" /> : null}
                      </div>
                      {c.waived && c.waiverReason ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          Waiver: {c.waiverReason}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canRun && !c.waived ? (
                        <select
                          value={c.status}
                          onChange={(e) =>
                            update.mutate({
                              id: c.id,
                              status: e.target.value as (typeof CHECK_STATUSES)[number],
                            })
                          }
                          className={selectClass}
                          aria-label={`Status for ${c.title}`}
                        >
                          {CHECK_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      {canApprove ? (
                        c.waived ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => waive.mutate({ id: c.id, waived: false })}
                            disabled={waive.isPending}
                          >
                            Un-waive
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setWaivingId(c.id);
                              setWaiverReason("");
                            }}
                          >
                            Waive
                          </Button>
                        )
                      ) : null}
                      {canRun ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => remove.mutate({ id: c.id })}
                          disabled={remove.isPending}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {waivingId === c.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={waiverReason}
                        onChange={(e) => setWaiverReason(e.target.value)}
                        placeholder="Justification for waiving this check"
                        aria-label="Waiver justification"
                        autoFocus
                      />
                      <Button size="sm" onClick={() => submitWaiver(c.id)} disabled={waive.isPending}>
                        Confirm waiver
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setWaivingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
