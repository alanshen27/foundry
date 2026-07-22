import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  // Stage statuses
  NOT_STARTED: "bg-zinc-800 text-zinc-300 border-zinc-700",
  DRAFT: "bg-blue-950 text-blue-300 border-blue-900",
  RUNNING: "bg-indigo-950 text-indigo-300 border-indigo-900",
  NEEDS_REVIEW: "bg-amber-950 text-amber-300 border-amber-900",
  APPROVED: "bg-emerald-950 text-emerald-300 border-emerald-900",
  BLOCKED: "bg-red-950 text-red-300 border-red-900",
  STALE: "bg-orange-950 text-orange-300 border-orange-900",
  // Verification / validation states
  UNVERIFIED: "bg-zinc-800 text-zinc-300 border-zinc-700",
  SIMULATED: "bg-purple-950 text-purple-300 border-purple-900",
  VERIFIED: "bg-emerald-950 text-emerald-300 border-emerald-900",
  REJECTED: "bg-red-950 text-red-300 border-red-900",
  PENDING: "bg-zinc-800 text-zinc-300 border-zinc-700",
  PASS: "bg-emerald-950 text-emerald-300 border-emerald-900",
  FAIL: "bg-red-950 text-red-300 border-red-900",
  WARNING: "bg-amber-950 text-amber-300 border-amber-900",
  SKIPPED: "bg-zinc-800 text-zinc-400 border-zinc-700",
  ERROR: "bg-red-950 text-red-300 border-red-900",
  // Requirement statuses
  PROPOSED: "bg-blue-950 text-blue-300 border-blue-900",
  ACCEPTED: "bg-emerald-950 text-emerald-300 border-emerald-900",
  // Requirement priority
  MUST: "bg-red-950 text-red-300 border-red-900",
  SHOULD: "bg-amber-950 text-amber-300 border-amber-900",
  MAY: "bg-zinc-800 text-zinc-300 border-zinc-700",
  // Severity
  INFO: "bg-zinc-800 text-zinc-300 border-zinc-700",
  MINOR: "bg-blue-950 text-blue-300 border-blue-900",
  MAJOR: "bg-amber-950 text-amber-300 border-amber-900",
  CRITICAL: "bg-red-950 text-red-300 border-red-900",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-semibold tracking-wide", STATUS_STYLES[status], className)}
    >
      {status.replaceAll("_", " ")}
    </Badge>
  );
}
