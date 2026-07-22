"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronsUpDown,
  Cpu,
  LayoutDashboard,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Rocket,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { UIMessage } from "ai";
import { STAGE_LABELS, STAGES, type Stage } from "@foundry/domain";
import { Button } from "@/components/ui/button";
import { PresenceBar } from "@/components/presence-bar";
import { CopilotProvider, useCopilot } from "@/components/copilot/copilot-provider";
import { ChatSidebar } from "@/components/copilot/chat-sidebar";
import { cn } from "@/lib/utils";

const STAGE_ICONS: Record<Stage, typeof Lightbulb> = {
  IDEATE: Lightbulb,
  ENGINEER: Cpu,
  VERIFY: ShieldCheck,
  LAUNCH: Rocket,
};

const STATUS_DOT: Record<string, string> = {
  NOT_STARTED: "bg-zinc-600",
  DRAFT: "bg-blue-400",
  RUNNING: "bg-indigo-400 animate-pulse",
  NEEDS_REVIEW: "bg-amber-400",
  APPROVED: "bg-emerald-400",
  BLOCKED: "bg-red-400",
  STALE: "bg-orange-400",
};

export type ShellWorkspace = { id: string; name: string; slug: string };

export type ProjectShellProps = {
  workspaces: ShellWorkspace[];
  workspace: ShellWorkspace;
  project: { id: string; name: string; slug: string };
  branchId: string;
  branchName: string;
  stageStatuses: Record<Stage, string>;
  user: { id: string; name: string };
  initialChatMessages: UIMessage[];
  children: ReactNode;
};

export function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: ShellWorkspace[];
  current: ShellWorkspace;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-muted/60 flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="from-primary/80 to-primary flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-xs font-bold text-black">
          {current.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{current.name}</span>
          <span className="text-muted-foreground block text-[11px]">workspace</span>
        </span>
        <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="bg-popover absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border shadow-lg"
        >
          <div className="max-h-64 overflow-y-auto p-1">
            {workspaces.map((w) => (
              <Link
                key={w.id}
                href={`/w/${w.slug}`}
                className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                onClick={() => setOpen(false)}
              >
                <span className="bg-muted flex size-5 items-center justify-center rounded text-[10px] font-bold">
                  {w.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === current.id ? <Check className="text-primary size-3.5" /> : null}
              </Link>
            ))}
          </div>
          <div className="border-t p-1">
            <Link
              href="/workspaces"
              className="text-muted-foreground hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
              onClick={() => setOpen(false)}
            >
              <Plus className="size-3.5" /> All workspaces
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShellInner({
  workspaces,
  workspace,
  project,
  branchName,
  stageStatuses,
  user,
  children,
}: Omit<ProjectShellProps, "initialChatMessages">) {
  const pathname = usePathname();
  const { open, setOpen } = useCopilot();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const base = `/w/${workspace.slug}/projects/${project.slug}`;

  const navItems = [
    { href: `${base}/overview`, label: "Overview", icon: LayoutDashboard, status: null as string | null },
    ...STAGES.map((stage) => ({
      href: `${base}/${stage.toLowerCase()}`,
      label: STAGE_LABELS[stage],
      icon: STAGE_ICONS[stage],
      status: stageStatuses[stage] ?? "NOT_STARTED",
    })),
  ];

  return (
    <div className="bg-background flex h-screen flex-col">
      <header className="bg-card/40 flex h-12 shrink-0 items-center gap-3 border-b px-3 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setNavCollapsed((c) => !c)}
          aria-label={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {navCollapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </Button>
        <Link
          href="/workspaces"
          className="text-primary text-sm font-black tracking-tight"
        >
          FOUNDRY
        </Link>
        <span className="text-border">/</span>
        <Link
          href={`/w/${workspace.slug}`}
          className="text-muted-foreground hover:text-foreground max-w-40 truncate text-sm transition-colors"
        >
          {workspace.name}
        </Link>
        <span className="text-border">/</span>
        <span className="max-w-52 truncate text-sm font-medium">{project.name}</span>
        <span className="border-border/70 text-muted-foreground rounded-md border px-1.5 py-0.5 font-mono text-[11px]">
          {branchName}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <PresenceBar
            channel={`presence:project:${project.id}`}
            self={{ userId: user.id, name: user.name }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Hide copilot" : "Show copilot"}
          >
            {open ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Stages"
          className={cn(
            "bg-card/30 flex shrink-0 flex-col border-r transition-[width] duration-150",
            navCollapsed ? "w-13 items-stretch p-2" : "w-60 p-3",
          )}
        >
          {!navCollapsed ? <WorkspaceSwitcher workspaces={workspaces} current={workspace} /> : null}
          <div className={cn("flex flex-col gap-0.5", !navCollapsed && "mt-4")}>
            {navItems.map((item) => {
              const active = pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg text-sm transition-colors",
                    navCollapsed ? "justify-center p-2" : "px-2.5 py-2",
                    active
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <span className="relative">
                    <Icon className={cn("size-4", active ? "text-primary" : "")} />
                    {navCollapsed && item.status ? (
                      <span
                        className={cn(
                          "absolute -top-1 -right-1 size-1.5 rounded-full",
                          STATUS_DOT[item.status],
                        )}
                      />
                    ) : null}
                  </span>
                  {!navCollapsed ? (
                    <>
                      <span className="flex-1">{item.label}</span>
                      {item.status ? (
                        <span
                          title={item.status.replaceAll("_", " ").toLowerCase()}
                          className={cn("size-2 rounded-full", STATUS_DOT[item.status])}
                        />
                      ) : null}
                    </>
                  ) : null}
                </Link>
              );
            })}
          </div>
          <div className={cn("mt-auto border-t pt-2", !navCollapsed && "pt-3")}>
            <Link
              href={`/w/${workspace.slug}/settings`}
              title="Workspace settings"
              className={cn(
                "text-muted-foreground hover:bg-muted/50 hover:text-foreground flex items-center gap-2.5 rounded-lg text-sm transition-colors",
                navCollapsed ? "justify-center p-2" : "px-2.5 py-2",
              )}
            >
              <Settings className="size-4" />
              {!navCollapsed ? "Workspace settings" : null}
            </Link>
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-auto">{children}</main>

        <ChatSidebar />
      </div>
    </div>
  );
}

export function ProjectShell(props: ProjectShellProps) {
  return (
    <CopilotProvider
      projectId={props.project.id}
      branchId={props.branchId}
      initialMessages={props.initialChatMessages}
    >
      <ShellInner {...props} />
    </CopilotProvider>
  );
}
