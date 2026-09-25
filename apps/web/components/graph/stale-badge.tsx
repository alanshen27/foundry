"use client";

/**
 * The amber dot that makes the graph visible without a graph view.
 *
 * Its whole job is that changing the battery on the Sourcing tab puts a mark
 * on a requirement row in Ideate and a check row in Verify. Nobody has to open
 * anything or remember to look — the consequence travels to where the work is.
 * That is the product's central claim rendered as about forty lines of UI.
 */

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

export type StaleNode = {
  id: string;
  refKey: string;
  label: string;
  staleReason: string | null;
  staleConfidence: number | null;
};

/**
 * One query per branch, shared by every row on the page through tRPC's cache,
 * so scattering this badge across three tables costs one request rather than
 * one per row.
 */
export function useStaleNodes(projectId: string, branchId: string) {
  const query = trpc.graph.staleNodes.useQuery({ projectId, branchId }, { staleTime: 15_000 });
  const byRefKey = new Map((query.data ?? []).map((n) => [n.refKey, n as StaleNode]));
  return { byRefKey, count: query.data?.length ?? 0, isLoading: query.isLoading };
}

export function StaleBadge({
  node,
  className,
}: {
  node: StaleNode | undefined;
  className?: string;
}) {
  if (!node) return null;
  // A heuristic chain gets the softer wording: claiming certainty about a
  // guess is how a warning badge stops being believed.
  const certain = (node.staleConfidence ?? 1) >= 0.9;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        certain
          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "border-muted-foreground/30 text-muted-foreground",
        className,
      )}
      title={
        node.staleReason
          ? `Needs another look — ${node.staleReason}`
          : "Affected by a recent change"
      }
    >
      <AlertTriangle className="size-2.5" aria-hidden />
      {certain ? "Review" : "Possibly affected"}
    </span>
  );
}
