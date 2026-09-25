"use client";

/**
 * "What changed between these two branches?"
 *
 * Every other graph surface answers a question within one branch. This one
 * looks across two — added, removed and changed requirements, parts,
 * firmware, CAD and checks, in one list, because they all live in one graph
 * instead of five separate tools each capable of diffing only its own
 * domain.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, GitCompareArrows, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { KIND_LABEL, groupByKind, viewFor } from "@/lib/graph/kind-labels";
import type { NodeDiff } from "@/lib/graph/compare";

type NodeStatus = NodeDiff["status"];

const STATUS_STYLE: Record<NodeStatus, string> = {
  added: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  removed: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  changed: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
};

type Branch = { id: string; name: string };

/** A branch's graph, and whether it needs building before it can be compared. */
function useComparableBranch(projectId: string, branchId: string | null, canEdit: boolean) {
  const snapshot = trpc.graph.snapshot.useQuery(
    { projectId, branchId: branchId ?? "" },
    { enabled: Boolean(branchId) },
  );
  const sync = trpc.graph.sync.useMutation();
  const missing = snapshot.data !== undefined && snapshot.data.nodes.length === 0;
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!branchId || !missing || !canEdit || requested.current === branchId) return;
    requested.current = branchId;
    sync.mutate({ projectId, branchId }, { onSuccess: () => void snapshot.refetch() });
  }, [branchId, missing, canEdit, projectId, sync, snapshot]);
  return { isLoading: snapshot.isLoading || sync.isPending, missing, error: snapshot.error };
}

export function BranchComparePanel({
  projectId,
  currentBranchId,
  canEdit,
  onClose,
}: {
  projectId: string;
  currentBranchId: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const branches = trpc.project.listBranches.useQuery({ projectId });
  const [branchAId, setBranchAId] = useState(currentBranchId);
  const [branchBId, setBranchBId] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(false);

  // Default B to whichever other branch shows up first, once the list loads.
  useEffect(() => {
    if (branchBId || !branches.data) return;
    const other = branches.data.find((b) => b.id !== branchAId);
    if (other) setBranchBId(other.id);
  }, [branches.data, branchAId, branchBId]);

  const a = useComparableBranch(projectId, branchAId, canEdit);
  const b = useComparableBranch(projectId, branchBId, canEdit);
  const ready = branchAId && branchBId && branchAId !== branchBId && !a.missing && !b.missing;

  const diff = trpc.graph.compareBranches.useQuery(
    { projectId, branchAId, branchBId: branchBId ?? "" },
    { enabled: Boolean(ready) },
  );

  const nodeGroups = groupByKind(diff.data?.nodes ?? []);
  const edges = diff.data?.edges ?? [];
  const nameOf = (id: string | null) => branches.data?.find((br) => br.id === id)?.name ?? "…";

  return (
    <aside className="bg-background flex h-full w-full max-w-lg flex-col border-l">
      <header className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <GitCompareArrows className="size-4 shrink-0 opacity-70" aria-hidden />
            Compare branches
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Everything the graph indexes — requirements, parts, CAD, firmware, checks — diffed
            across two branches at once.
          </p>
        </div>
        <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close branch compare">
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex items-center gap-2 border-b p-3">
        <BranchSelect
          label="A"
          value={branchAId}
          branches={branches.data ?? []}
          onChange={setBranchAId}
        />
        <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <BranchSelect
          label="B"
          value={branchBId ?? ""}
          branches={branches.data ?? []}
          onChange={setBranchBId}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {branches.data && branches.data.length < 2 ? (
          <p className="text-muted-foreground p-4 text-sm">
            This project has one branch. Create another to compare against.
          </p>
        ) : branchAId === branchBId ? (
          <p className="text-muted-foreground p-4 text-sm">Pick two different branches.</p>
        ) : a.isLoading || b.isLoading || diff.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-48" />
          </div>
        ) : a.error || b.error || diff.error ? (
          <p className="text-destructive p-4 text-sm">
            {(a.error ?? b.error ?? diff.error)?.message}
          </p>
        ) : a.missing || b.missing ? (
          <p className="text-muted-foreground p-4 text-sm">
            {canEdit
              ? "Building the product graph for the branch that doesn't have one yet…"
              : "One of these branches has no product graph yet. Someone with edit access needs to open this panel once."}
          </p>
        ) : !diff.data ? null : diff.data.summary.added +
            diff.data.summary.removed +
            diff.data.summary.changed ===
          0 ? (
          <div className="text-muted-foreground p-4 text-sm">
            <p>Nothing differs between these branches.</p>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground border-b px-4 py-2.5 text-xs">
              {diff.data.summary.added} added · {diff.data.summary.removed} removed ·{" "}
              {diff.data.summary.changed} changed
            </p>
            {nodeGroups.map(([kind, nodes]) => (
              <section key={kind} className="border-b last:border-b-0">
                <h3 className="text-muted-foreground bg-muted/30 px-4 py-1.5 text-[11px] font-medium tracking-wide uppercase">
                  {KIND_LABEL[kind] ?? kind}
                </h3>
                <ul>
                  {nodes.map((node) => {
                    const view = viewFor(node.kind);
                    return (
                      <li
                        key={node.refKey}
                        className="border-border/60 flex items-start justify-between gap-2 border-b px-4 py-2.5 last:border-b-0"
                      >
                        <div className="min-w-0">
                          {view ? (
                            <Link
                              href={`?view=${view}`}
                              onClick={onClose}
                              className="text-sm font-medium underline-offset-2 hover:underline"
                            >
                              {node.label}
                            </Link>
                          ) : (
                            <span className="text-sm font-medium">{node.label}</span>
                          )}
                          {node.status === "changed" ? (
                            <p className="text-muted-foreground mt-0.5 text-xs">
                              Different on {nameOf(branchAId)} and {nameOf(branchBId)}.
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                            STATUS_STYLE[node.status],
                          )}
                        >
                          {STATUS_LABEL[node.status]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {edges.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowLinks((on) => !on)}
                className="text-muted-foreground hover:text-foreground w-full px-4 py-2.5 text-left text-xs underline-offset-2 hover:underline"
              >
                {showLinks ? "Hide" : "Show"} {edges.length} link{edges.length === 1 ? "" : "s"}{" "}
                that changed
              </button>
            ) : null}
            {showLinks
              ? edges.map((edge) => (
                  <div
                    key={edge.key}
                    className="border-border/60 flex items-center justify-between gap-2 border-b px-4 py-2 text-xs last:border-b-0"
                  >
                    <span className="text-muted-foreground truncate">
                      {edge.fromLabel} <ArrowRight className="inline size-2.5" aria-hidden />{" "}
                      {edge.toLabel}{" "}
                      <span className="opacity-70">
                        ({edge.kind.toLowerCase().replace(/_/g, " ")})
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                        edge.status === "added" ? STATUS_STYLE.added : STATUS_STYLE.removed,
                      )}
                    >
                      {edge.status === "added" ? "Added" : "Removed"}
                    </span>
                  </div>
                ))
              : null}
          </>
        )}
      </div>
    </aside>
  );
}

function BranchSelect({
  label,
  value,
  branches,
  onChange,
}: {
  label: string;
  value: string;
  branches: Branch[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
      <span className="text-muted-foreground shrink-0 font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-input bg-background w-full min-w-0 truncate border px-2 py-1 text-xs"
        aria-label={`Branch ${label}`}
      >
        {value && !branches.some((b) => b.id === value) ? (
          <option value={value}>Loading…</option>
        ) : null}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Trigger button + portalled overlay, wired into a stage header. */
export function BranchCompareTrigger({
  projectId,
  branchId,
  canEdit,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const branches = trpc.project.listBranches.useQuery({ projectId });
  const hasOtherBranch = (branches.data?.length ?? 0) > 1;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={branches.isFetched && !hasOtherBranch}
        title={
          branches.isFetched && !hasOtherBranch
            ? "Create a second branch first"
            : "Compare two branches"
        }
      >
        <GitCompareArrows className="size-4" />
        Compare branches
      </Button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex justify-end bg-black/20"
              role="dialog"
              aria-modal
            >
              <button
                type="button"
                className="flex-1 cursor-default"
                aria-label="Close branch compare"
                onClick={() => setOpen(false)}
              />
              <BranchComparePanel
                projectId={projectId}
                currentBranchId={branchId}
                canEdit={canEdit}
                onClose={() => setOpen(false)}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
