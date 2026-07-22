"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { FolderKanban, LayoutGrid, LogOut, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceSwitcher, type ShellWorkspace } from "@/components/project-shell";
import { cn } from "@/lib/utils";

/**
 * Shell for non-project pages (workspace list, workspace home, settings):
 * same sidebar language as the project shell so navigation feels continuous.
 */
export function HomeShell({
  workspaces,
  current,
  userName,
  children,
}: {
  workspaces: ShellWorkspace[];
  current?: ShellWorkspace;
  userName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const navItems = [
    { href: "/workspaces", label: "All workspaces", icon: LayoutGrid },
    ...(current
      ? [
          { href: `/w/${current.slug}`, label: "Projects", icon: FolderKanban },
          { href: `/w/${current.slug}/settings`, label: "Settings", icon: Settings },
        ]
      : []),
  ];

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    router.push("/auth/sign-in");
    router.refresh();
  }

  return (
    <div className="bg-background flex h-screen">
      <nav aria-label="Main" className="bg-card/30 flex w-60 shrink-0 flex-col border-r p-3">
        <Link href="/workspaces" className="text-primary px-2 py-1 text-sm font-black tracking-tight">
          FOUNDRY
        </Link>
        <div className="mt-3">
          {current ? (
            <WorkspaceSwitcher workspaces={workspaces} current={current} />
          ) : null}
        </div>
        <div className="mt-3 flex flex-col gap-0.5">
          {navItems.map((item) => {
            const active =
              item.href === "/workspaces"
                ? pathname === "/workspaces"
                : pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                  active
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <Icon className={cn("size-4", active ? "text-primary" : "")} />
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
          <span className="text-muted-foreground truncate px-1 text-xs">{userName}</span>
          <Button variant="ghost" size="icon-sm" onClick={signOut} aria-label="Sign out">
            <LogOut className="size-4" />
          </Button>
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl p-6 lg:p-10">{children}</div>
      </main>
    </div>
  );
}
