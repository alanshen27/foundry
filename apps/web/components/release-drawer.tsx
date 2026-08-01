"use client";

/**
 * Release status without leaving the workbench: a header chip with the latest
 * frozen version, opening a drawer with the branch's release timeline. Creating
 * releases, listings, and media stays on the Launch stage.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Rocket, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type Props = {
  projectId: string;
  branchId: string;
  /** Launch stage URL, e.g. `/w/acme/projects/widget/launch`. */
  launchHref: string;
};

export function ReleaseChip({ projectId, branchId, launchHref }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const releases = trpc.launch.listReleases.useQuery({ projectId, branchId });

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const latest = releases.data?.[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={latest ? `Latest release ${latest.version}` : "No releases yet"}
        className={cn(
          "flex h-6 items-center gap-1.5 rounded-none border px-2 font-mono text-[11px] leading-none transition-colors",
          open
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Rocket className="size-3" strokeWidth={1.75} />
        {latest ? latest.version : "unreleased"}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Releases"
          className="bg-popover absolute top-full right-0 z-50 mt-1.5 w-80 overflow-hidden rounded-none border shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-[13px] font-medium">Releases</span>
            <div className="flex items-center gap-2">
              <Link
                href={launchHref}
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                onClick={() => setOpen(false)}
              >
                Open Launch
              </Link>
              <button
                type="button"
                aria-label="Close releases"
                onClick={() => setOpen(false)}
                className="hover:bg-muted rounded p-0.5"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {releases.isLoading ? (
              <p className="text-muted-foreground px-3 py-3 text-xs">Loading…</p>
            ) : !releases.data || releases.data.length === 0 ? (
              <p className="text-muted-foreground px-3 py-3 text-xs">
                No releases on this branch yet. Approve verification, then cut one on Launch.
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {releases.data.map((r) => (
                  <li key={r.id} className="flex flex-col gap-0.5 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12px] font-medium">{r.version}</span>
                      <span className="text-muted-foreground text-[11px]">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-[11px]">by {r.createdByName}</span>
                    {r.notes ? (
                      <p className="text-muted-foreground line-clamp-2 text-xs">{r.notes}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
