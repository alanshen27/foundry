import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const styles = {
    primary:
      "bg-orange-600 text-white hover:bg-orange-500 disabled:bg-zinc-700 disabled:text-zinc-400",
    secondary: "border border-zinc-700 text-zinc-200 hover:border-zinc-500 hover:text-white",
    ghost: "text-zinc-400 hover:text-white",
  } as const;
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-orange-500",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("rounded-lg border border-zinc-800 bg-zinc-900/60 p-4", className)}
      {...props}
    />
  );
}

const STATUS_STYLES: Record<string, string> = {
  NOT_STARTED: "bg-zinc-800 text-zinc-400",
  DRAFT: "bg-blue-950 text-blue-300",
  RUNNING: "bg-indigo-950 text-indigo-300",
  NEEDS_REVIEW: "bg-amber-950 text-amber-300",
  APPROVED: "bg-emerald-950 text-emerald-300",
  BLOCKED: "bg-red-950 text-red-300",
  STALE: "bg-orange-950 text-orange-300",
  UNVERIFIED: "bg-zinc-800 text-zinc-400",
  SIMULATED: "bg-purple-950 text-purple-300",
  VERIFIED: "bg-emerald-950 text-emerald-300",
};

/**
 * Status badge with a text label (never color-only, per accessibility NFR).
 */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide",
        STATUS_STYLES[status] ?? "bg-zinc-800 text-zinc-400",
        className,
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 p-8 text-center">
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {children ? <div className="max-w-md text-sm text-zinc-500">{children}</div> : null}
    </div>
  );
}
