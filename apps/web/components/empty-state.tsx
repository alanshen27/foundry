import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="text-muted-foreground max-w-md text-sm">{children}</div> : null}
    </div>
  );
}
