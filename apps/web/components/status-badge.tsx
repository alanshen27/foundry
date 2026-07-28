import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  NOT_STARTED: "bg-muted text-muted-foreground border-transparent",
  DRAFT: "bg-sky-500/10 text-sky-700 border-transparent dark:text-sky-300",
  RUNNING: "bg-primary/10 text-primary border-transparent",
  NEEDS_REVIEW: "bg-amber-500/10 text-amber-700 border-transparent dark:text-amber-300",
  APPROVED: "bg-emerald-500/10 text-emerald-700 border-transparent dark:text-emerald-300",
  BLOCKED: "bg-red-500/10 text-red-700 border-transparent dark:text-red-300",
  STALE: "bg-orange-500/10 text-orange-700 border-transparent dark:text-orange-300",
  UNVERIFIED: "bg-muted text-muted-foreground border-transparent",
  SIMULATED: "bg-violet-500/10 text-violet-700 border-transparent dark:text-violet-300",
  VERIFIED: "bg-emerald-500/10 text-emerald-700 border-transparent dark:text-emerald-300",
  REJECTED: "bg-red-500/10 text-red-700 border-transparent dark:text-red-300",
  PENDING: "bg-muted text-muted-foreground border-transparent",
  PASS: "bg-emerald-500/10 text-emerald-700 border-transparent dark:text-emerald-300",
  FAIL: "bg-red-500/10 text-red-700 border-transparent dark:text-red-300",
  WARNING: "bg-amber-500/10 text-amber-700 border-transparent dark:text-amber-300",
  SKIPPED: "bg-muted text-muted-foreground border-transparent",
  ERROR: "bg-red-500/10 text-red-700 border-transparent dark:text-red-300",
  PROPOSED: "bg-sky-500/10 text-sky-700 border-transparent dark:text-sky-300",
  ACCEPTED: "bg-emerald-500/10 text-emerald-700 border-transparent dark:text-emerald-300",
  MUST: "bg-red-500/10 text-red-700 border-transparent dark:text-red-300",
  SHOULD: "bg-amber-500/10 text-amber-700 border-transparent dark:text-amber-300",
  MAY: "bg-muted text-muted-foreground border-transparent",
  INFO: "bg-muted text-muted-foreground border-transparent",
  MINOR: "bg-sky-500/10 text-sky-700 border-transparent dark:text-sky-300",
  MAJOR: "bg-amber-500/10 text-amber-700 border-transparent dark:text-amber-300",
  CRITICAL: "bg-red-500/10 text-red-700 border-transparent dark:text-red-300",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-none px-1.5 py-0 text-[11px] font-medium tracking-wide",
        STATUS_STYLES[status],
        className,
      )}
    >
      {status.replaceAll("_", " ")}
    </Badge>
  );
}
