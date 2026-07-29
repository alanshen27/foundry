"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Boxes, ChevronDown, ChevronRight, UsersRound } from "lucide-react";
import { navIconClass, navItemClass } from "@/lib/nav-item";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * Projects shared from workspaces other people own. Owned projects live in the
 * folder tree; shared ones are a flat list because their folders belong to the
 * owning workspace. Renders nothing when nothing is shared.
 */
export function SharedProjectsNav({
  currentWorkspaceId,
  className,
}: {
  /** Skipped in the list: the open workspace already shows its own tree. */
  currentWorkspaceId?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);
  const { data } = trpc.workspace.sharedWithMe.useQuery(undefined, { staleTime: 60_000 });

  const shared = (data ?? []).filter((project) => project.workspaceId !== currentWorkspaceId);
  if (shared.length === 0) return null;

  return (
    <div className={cn("shrink-0", className)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(navItemClass(false), "w-full")}
        aria-expanded={expanded}
      >
        <UsersRound className={navIconClass(false)} strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-left">Shared with me</span>
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        ) : (
          <ChevronRight className="size-3 shrink-0 opacity-60" />
        )}
      </button>

      {expanded ? (
        <div data-testid="shared-with-me">
          {shared.map((project) => {
            const base = `/w/${project.workspaceSlug}/projects/${project.slug}`;
            const active = Boolean(pathname?.startsWith(base));
            return (
              <Link
                key={project.id}
                href={`${base}/overview`}
                title={`${project.name} — ${project.workspaceName} (${project.ownerName})`}
                className={cn(
                  "flex items-center gap-2.5 rounded-none py-[7px] pr-2.5 pl-[22px] text-[13px] transition-colors",
                  active
                    ? "bg-sidebar-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                )}
              >
                <Boxes className="size-[15px] shrink-0 opacity-70" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <span className="text-muted-foreground/70 max-w-[40%] shrink-0 truncate text-[11px]">
                  {project.workspaceName}
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
