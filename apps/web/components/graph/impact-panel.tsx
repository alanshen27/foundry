"use client";

/**
 * "If I change this, what else has to change?"
 *
 * The panel is deliberately a list rather than a node-link diagram. A
 * force-directed picture of four hundred nodes looks impressive for two
 * seconds and tells an engineer nothing; a list that says "the enclosure is
 * affected, because it houses the cell, and here is the path" is something
 * they can act on. Every row links to the artifact it names, because a
 * consequence you cannot navigate to is a consequence you will not fix.
 *
 * Confidence is shown, never hidden. Some links are structural facts — a
 * footprint names the part it realises — and some are name guesses. Presenting
 * both with the same certainty is how a tool teaches people to ignore it.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowRight, Check, CircleAlert, GitBranch, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// ReactFlow is only needed once someone asks for the picture.
const ImpactGraph = dynamic(
  () => import("@/components/graph/impact-graph").then((m) => m.ImpactGraph),
  { ssr: false, loading: () => <Skeleton className="m-4 h-40" /> },
);
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { KIND_LABEL, KIND_ORDER, STRUCTURAL_KINDS, viewFor } from "@/lib/graph/kind-labels";

type Severity = "review" | "likely" | "possible";

const SEVERITY_STYLE: Record<Severity, string> = {
  review: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  likely: "border-muted-foreground/30 text-muted-foreground",
  possible: "border-muted-foreground/20 text-muted-foreground/80",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  review: "Review",
  likely: "Likely",
  possible: "Possible",
};

export function ImpactPanel({
  projectId,
  branchId,
  refKey,
  title,
  canEdit,
  onClose,
}: {
  projectId: string;
  branchId: string;
  refKey: string;
  title: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [flagged, setFlagged] = useState(false);
  const [showStructural, setShowStructural] = useState(false);
  const [mode, setMode] = useState<"list" | "graph">("list");

  const impact = trpc.graph.impact.useQuery({ projectId, branchId, refKey });
  const markImpacted = trpc.graph.markImpacted.useMutation({
    onSuccess: () => {
      setFlagged(true);
      void utils.graph.staleNodes.invalidate({ projectId, branchId });
    },
  });
  // The graph is built as a side effect of editing, so a project nobody has
  // touched since this shipped — every existing project, and a fresh seed —
  // has no graph yet. Rather than open on "nothing depends on this", which
  // would be false, build it the first time someone asks.
  const sync = trpc.graph.sync.useMutation({
    onSuccess: () => {
      void utils.graph.impact.invalidate({ projectId, branchId, refKey });
      void utils.graph.staleNodes.invalidate({ projectId, branchId });
    },
  });
  const graphMissing = impact.data !== undefined && impact.data.root === null;
  const syncRequested = useRef(false);
  useEffect(() => {
    if (!graphMissing || !canEdit || syncRequested.current) return;
    syncRequested.current = true;
    sync.mutate({ projectId, branchId });
  }, [graphMissing, canEdit, sync, projectId, branchId]);

  const markReviewed = trpc.graph.markReviewed.useMutation({
    onSuccess: () => {
      void utils.graph.impact.invalidate({ projectId, branchId, refKey });
      void utils.graph.staleNodes.invalidate({ projectId, branchId });
    },
  });

  const impacted = impact.data?.impacted ?? [];

  // Grouped by kind so the reader sees "three requirements and the firmware"
  // rather than a flat list of twenty things in traversal order.
  const groups = new Map<string, typeof impacted>();
  for (const node of impacted) {
    if (STRUCTURAL_KINDS.has(node.kind) && !showStructural) continue;
    const bucket = groups.get(node.kind);
    if (bucket) bucket.push(node);
    else groups.set(node.kind, [node]);
  }
  const ordered = [...groups.entries()].sort(
    ([a], [b]) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b),
  );
  const structuralCount = impacted.filter((n) => STRUCTURAL_KINDS.has(n.kind)).length;
  const actionable = impacted.length - structuralCount;

  return (
    <aside className="bg-background flex h-full w-full max-w-md flex-col border-l">
      <header className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <GitBranch className="size-4 shrink-0 opacity-70" aria-hidden />
            What this affects
          </h2>
          <p className="text-muted-foreground mt-0.5 truncate text-xs" title={title}>
            {title}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex border" role="group" aria-label="Impact view">
            {(["list", "graph"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "px-2 py-0.5 text-[11px] capitalize",
                  mode === m ? "bg-muted font-medium" : "text-muted-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close impact panel">
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {impact.isLoading || sync.isPending ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-48" />
          </div>
        ) : impact.error ? (
          <p className="text-destructive p-4 text-sm">{impact.error.message}</p>
        ) : sync.error ? (
          <p className="text-destructive p-4 text-sm">
            Could not build the product graph: {sync.error.message}
          </p>
        ) : graphMissing ? (
          <p className="text-muted-foreground p-4 text-sm">
            {canEdit
              ? "Building the product graph…"
              : "This project's product graph has not been built yet. Someone with edit access needs to open this panel once."}
          </p>
        ) : impacted.length === 0 ? (
          <div className="text-muted-foreground p-4 text-sm">
            <p>Nothing downstream depends on this yet.</p>
            <p className="mt-2 text-xs">
              Most links are worked out automatically from reference designators, nets, KCL imports
              and check target paths. Links that carry a design decision — which part satisfies
              which requirement — have to be drawn, by you or by the copilot.
            </p>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground border-b px-4 py-2.5 text-xs">
              {actionable} artifact{actionable === 1 ? "" : "s"} would need another look
              {structuralCount > 0 ? `, through ${structuralCount} wiring links` : ""}.
            </p>
            {mode === "graph" ? (
              <div className="h-[60vh] border-b">
                <ImpactGraph
                  root={{ refKey, label: impact.data?.root?.label ?? title }}
                  impacted={impacted}
                  includeStructural={showStructural}
                />
              </div>
            ) : null}
            {mode === "list" &&
              ordered.map(([kind, nodes]) => (
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
                          className="border-border/60 border-b px-4 py-2.5 last:border-b-0"
                        >
                          <div className="flex items-start justify-between gap-2">
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
                              <p className="text-muted-foreground mt-0.5 text-xs">{node.reason}</p>
                              {/* The path is the evidence. Without it the row is
                                an assertion; with it, it is an argument. */}
                              <p className="text-muted-foreground/70 mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                                {node.path.map((hop, i) => (
                                  <span key={i} className="inline-flex items-center gap-1">
                                    {i === 0 ? <span>{hop.fromLabel}</span> : null}
                                    <ArrowRight className="size-2.5 shrink-0" aria-hidden />
                                    <span>{hop.toLabel}</span>
                                  </span>
                                ))}
                              </p>
                            </div>
                            <span
                              className={cn(
                                "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                                SEVERITY_STYLE[node.severity as Severity],
                              )}
                            >
                              {SEVERITY_LABEL[node.severity as Severity]}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            {structuralCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowStructural((on) => !on)}
                className="text-muted-foreground hover:text-foreground w-full px-4 py-2.5 text-left text-xs underline-offset-2 hover:underline"
              >
                {showStructural ? "Hide" : "Show"} {structuralCount} wiring link
                {structuralCount === 1 ? "" : "s"} (nets, pins, schematic parts)
              </button>
            ) : null}
          </>
        )}
      </div>

      {impacted.length > 0 && canEdit ? (
        <footer className="flex flex-col gap-2 border-t p-4">
          <Button
            onClick={() => markImpacted.mutate({ projectId, branchId, refKey })}
            disabled={markImpacted.isPending || flagged}
          >
            {markImpacted.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : flagged ? (
              <Check className="size-4" />
            ) : (
              <AlertTriangle className="size-4" />
            )}
            {flagged
              ? `Flagged ${markImpacted.data?.marked ?? 0} for review`
              : "Flag these for review"}
          </Button>
          <p className="text-muted-foreground text-[11px]">
            Marks each one across the workspace until it is revised or you accept it as is.
            {markReviewed.isPending ? " Saving…" : ""}
          </p>
          {markImpacted.error ? (
            <p className="text-destructive flex items-center gap-1 text-xs">
              <CircleAlert className="size-3" /> {markImpacted.error.message}
            </p>
          ) : null}
        </footer>
      ) : null}
    </aside>
  );
}
