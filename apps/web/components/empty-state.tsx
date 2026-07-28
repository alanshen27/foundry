import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Dashed slot with a faint dot-matrix field — quiet, on-brand emptiness. */
export function EmptyState({
  title,
  children,
  className,
}: {
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex h-full min-h-48 flex-col items-center justify-center gap-2 overflow-hidden rounded-none border border-dashed p-8 text-center",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(circle,var(--border)_1px,transparent_1.1px)] [background-size:12px_12px]"
      />
      <span aria-hidden className="relative inline-grid grid-cols-3 gap-[3px] pb-1">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={cn("size-[3.5px]", i === 4 ? "bg-primary" : "bg-border")} />
        ))}
      </span>
      <p className="relative font-mono text-sm font-medium tracking-[-0.02em]">{title}</p>
      {children ? (
        <div className="text-muted-foreground relative max-w-md text-sm">{children}</div>
      ) : null}
    </div>
  );
}
