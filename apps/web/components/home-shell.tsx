"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { FolderKanban, Globe, LogOut, Settings, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FoundryMark } from "@/components/foundry-mark";
import { InteractiveDotField } from "@/components/interactive-dot-field";
import { UserAvatar } from "@/components/user-avatar";
import { SharedProjectsNav } from "@/components/shared-projects-nav";
import { WorkspaceSwitcher, type ShellWorkspace } from "@/components/project-shell";
import {
  WorkspaceFileTree,
  type TreeFolder,
  type TreeProject,
} from "@/components/workspace-file-tree";
import { navIconClass, navItemClass } from "@/lib/nav-item";
import { cn } from "@/lib/utils";

export type ShellProject = TreeProject;
export type ShellFolder = TreeFolder;

/**
 * Shell for non-project pages (workspace home, settings, sites, manage):
 * projects file tree on top; Settings + Manage workspaces pinned bottom.
 */
export function HomeShell({
  workspaces,
  current,
  projects = [],
  folders = [],
  user,
  contentClassName,
  children,
}: {
  workspaces: ShellWorkspace[];
  current?: ShellWorkspace;
  projects?: ShellProject[];
  folders?: ShellFolder[];
  user: { id: string; name: string; avatarUrl?: string | null };
  contentClassName?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const homeHref = current ? `/w/${current.slug}` : "/workspaces?manage=1";
  const sitesHref = current ? `/w/${current.slug}/sites` : null;
  const settingsHref = current ? `/w/${current.slug}/settings` : null;

  const onProjectsRoot =
    Boolean(current) &&
    (pathname === `/w/${current!.slug}` ||
      Boolean(pathname?.startsWith(`/w/${current!.slug}/folders/`)));
  const onSites = Boolean(sitesHref && pathname?.startsWith(sitesHref));
  const onSettings = Boolean(settingsHref && pathname === settingsHref);
  const onManage = pathname === "/workspaces";
  const onAccount = pathname === "/account";

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    router.push("/auth/sign-in");
    router.refresh();
  }

  return (
    <div className="bg-background flex h-screen">
      <nav
        aria-label="Main"
        className="border-sidebar-border bg-sidebar flex w-[240px] shrink-0 flex-col border-r"
      >
        <div className="border-sidebar-border flex h-12 items-center border-b px-3">
          <Link href={homeHref}>
            <FoundryMark />
          </Link>
        </div>

        <div className="px-2 pt-3">
          {current ? <WorkspaceSwitcher workspaces={workspaces} current={current} /> : null}
        </div>

        <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
          {current ? (
            <>
              <div className="flex flex-col gap-0.5">
                <Link href={`/w/${current.slug}`} className={navItemClass(onProjectsRoot)}>
                  <FolderKanban className={navIconClass(onProjectsRoot)} strokeWidth={1.75} />
                  Projects
                </Link>

                {sitesHref ? (
                  <Link href={sitesHref} className={navItemClass(onSites)}>
                    <Globe className={navIconClass(onSites)} strokeWidth={1.75} />
                    Sites
                  </Link>
                ) : null}
              </div>

              <WorkspaceFileTree
                workspaceId={current.id}
                workspaceSlug={current.slug}
                projects={projects}
                folders={folders}
              />

              <SharedProjectsNav currentWorkspaceId={current.id} className="mt-3" />
            </>
          ) : null}
        </div>

        <div className="border-sidebar-border mt-auto border-t px-2 pt-2 pb-2">
          <div className="flex flex-col gap-0.5">
            {settingsHref ? (
              <Link href={settingsHref} className={navItemClass(onSettings)}>
                <Settings className={navIconClass(onSettings)} strokeWidth={1.75} />
                Settings
              </Link>
            ) : null}
            <Link href="/workspaces?manage=1" className={navItemClass(onManage)}>
              <Waypoints className={navIconClass(onManage)} strokeWidth={1.75} />
              Manage workspaces
            </Link>
          </div>

          <div className="mt-2 flex items-center gap-2 border-t px-1 pt-2">
            <Link
              href="/account"
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-none px-1 py-0.5 transition-colors",
                onAccount
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-sidebar-accent/70 hover:text-foreground",
              )}
              aria-current={onAccount ? "page" : undefined}
            >
              <UserAvatar
                userId={user.id}
                name={user.name}
                avatarUrl={user.avatarUrl}
                className="size-7 text-[10px]"
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-xs",
                  onAccount ? "text-primary font-medium" : "text-muted-foreground",
                )}
              >
                {user.name}
              </span>
            </Link>
            <Button variant="ghost" size="icon-sm" onClick={signOut} aria-label="Sign out">
              <LogOut className="size-3.5" />
            </Button>
          </div>
        </div>
      </nav>

      <main className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", contentClassName)}>
        {!contentClassName?.includes("p-0") ? (
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <InteractiveDotField gap={16} radius={52} />
          </div>
        ) : null}
        <div
          className={cn(
            "relative z-10 min-h-0 flex-1",
            contentClassName?.includes("p-0") ? "flex flex-col" : "overflow-y-auto p-8",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
