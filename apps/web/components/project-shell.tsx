"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronsUpDown,
  Combine,
  FolderGit2,
  LayoutDashboard,
  Lightbulb,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Rocket,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { UIMessage } from "ai";
import type { Stage } from "@foundry/domain";
import { Button } from "@/components/ui/button";
import { FoundryMark } from "@/components/foundry-mark";
import { InteractiveDotField } from "@/components/interactive-dot-field";
import { PresenceBar } from "@/components/presence-bar";
import { ShareButton } from "@/components/share-button";
import { SignalIconTile } from "@/components/signal-icons";
import {
  CopilotProvider,
  useCopilot,
  type ChatCategory,
  type ChatChannel,
} from "@/components/copilot/copilot-provider";
import { ChatSidebar } from "@/components/copilot/chat-sidebar";
import { DiscordChat } from "@/components/copilot/discord-chat";
import { STAGE_THEME } from "@/lib/stage-theme";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<string, string> = {
  NOT_STARTED: "bg-muted-foreground/35",
  DRAFT: "bg-sky-500",
  RUNNING: "bg-primary animate-pulse",
  NEEDS_REVIEW: "bg-amber-500",
  APPROVED: "bg-emerald-500",
  BLOCKED: "bg-red-500",
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
  user: { id: string; name: string; avatarUrl?: string | null };
  chatChannels: ChatChannel[];
  chatCategories: ChatCategory[];
  defaultChannelId: string;
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
        className="hover:bg-muted flex w-full items-center gap-2.5 rounded-none px-2 py-1.5 text-left transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <SignalIconTile
          kind="workspace"
          seed={current.id}
          letter={current.name}
          className="size-6"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{current.name}</span>
          <span className="text-muted-foreground block font-mono text-[10px] tracking-[0.08em] uppercase">
            Workspace
          </span>
        </span>
        <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="bg-popover absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-none border shadow-[var(--shadow-panel)]"
        >
          <div className="max-h-64 overflow-y-auto p-1">
            {workspaces.map((w) => (
              <Link
                key={w.id}
                href={`/w/${w.slug}`}
                className="hover:bg-muted flex items-center gap-2 rounded-none px-2 py-1.5 text-[13px]"
                onClick={() => setOpen(false)}
              >
                <SignalIconTile kind="workspace" seed={w.id} letter={w.name} className="size-5" />
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === current.id ? <Check className="text-primary size-3.5" /> : null}
              </Link>
            ))}
          </div>
          <div className="border-t p-1">
            <Link
              href="/workspaces?manage=1"
              className="text-muted-foreground hover:bg-muted flex items-center gap-2 rounded-none px-2 py-1.5 text-[13px]"
              onClick={() => setOpen(false)}
            >
              <Plus className="size-3.5" /> Manage workspaces
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Process stages + Repository. CAD / Schematic / PCB open as Engineer top tabs.
 */
type ProcessStep = {
  key: string;
  label: string;
  icon: typeof Lightbulb;
  href: string;
  stage: Stage | null;
};

function processSteps(base: string): ProcessStep[] {
  return [
    {
      key: "overview",
      label: "Overview",
      icon: LayoutDashboard,
      href: `${base}/overview`,
      stage: null,
    },
    { key: "ideate", label: "Ideation", icon: Lightbulb, href: `${base}/ideate`, stage: "IDEATE" },
    {
      key: "engineer",
      label: "Engineer",
      icon: Combine,
      href: `${base}/engineer`,
      stage: "ENGINEER",
    },
    {
      key: "repository",
      label: "Repository",
      icon: FolderGit2,
      href: `${base}/engineer?view=code`,
      stage: "ENGINEER",
    },
    { key: "verify", label: "Verify", icon: ShieldCheck, href: `${base}/verify`, stage: "VERIFY" },
    { key: "launch", label: "Launch", icon: Rocket, href: `${base}/launch`, stage: "LAUNCH" },
  ];
}

function ProcessFooter({
  base,
  stageStatuses,
  workspaceSlug,
}: {
  base: string;
  stageStatuses: Record<Stage, string>;
  workspaceSlug: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const steps = processSteps(base);

  return (
    <footer className="bg-card flex h-10 shrink-0 items-center border-t px-1">
      <nav aria-label="Design process" className="flex h-full min-w-0 flex-1 items-stretch gap-0.5">
        {steps.map((step) => {
          const stepPath = step.href.split("?")[0] ?? step.href;
          const onPath = Boolean(pathname?.startsWith(stepPath));
          const active =
            step.key === "repository"
              ? onPath && viewParam === "code"
              : step.key === "engineer"
                ? onPath && viewParam !== "code"
                : onPath;
          const status = step.stage ? (stageStatuses[step.stage] ?? "NOT_STARTED") : null;
          const Icon = step.icon;
          const phase = step.stage ? STAGE_THEME[step.stage] : null;
          return (
            <Link
              key={step.key}
              href={step.href}
              className={cn(
                "group relative flex items-center gap-1.5 rounded-none px-2.5 text-[12px] font-medium transition-colors sm:px-3",
                active
                  ? (phase?.active ?? "bg-muted text-foreground")
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {active && phase ? (
                <span
                  aria-hidden
                  className={cn("absolute inset-x-2 top-0 h-0.5 rounded-full", phase.rail)}
                />
              ) : null}
              <Icon
                className={cn("size-3.5", active ? "" : (phase?.idleIcon ?? "opacity-80"))}
                strokeWidth={1.75}
              />
              <span className="hidden md:inline">{step.label}</span>
              {status && step.key !== "repository" ? (
                <span
                  title={status.replaceAll("_", " ").toLowerCase()}
                  className={cn("size-1.5 rounded-full", STATUS_DOT[status])}
                />
              ) : null}
            </Link>
          );
        })}
      </nav>
      <Link
        href={`/w/${workspaceSlug}/settings`}
        title="Workspace settings"
        className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 items-center justify-center rounded-none"
      >
        <Settings className="size-3.5" strokeWidth={1.75} />
      </Link>
    </footer>
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
  const base = `/w/${workspace.slug}/projects/${project.slug}`;
  const isChatPopout = Boolean(pathname?.endsWith("/chat"));

  if (isChatPopout) {
    return <DiscordChat projectName={project.name} workspaceName={workspace.name} user={user} />;
  }

  return (
    <div className="bg-background flex h-screen flex-col">
      <header className="bg-card relative z-20 flex h-11 shrink-0 items-center gap-1.5 border-b px-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
          <Link
            href={`/w/${workspace.slug}`}
            className="text-foreground flex size-5 shrink-0 items-center justify-center"
          >
            <FoundryMark size="sm" showWord={false} />
          </Link>
          <span className="text-border flex h-5 items-center text-[13px] leading-none" aria-hidden>
            /
          </span>
          <div className="flex h-5 min-w-0 max-w-44 items-center">
            <HeaderWorkspaceMenu workspaces={workspaces} current={workspace} />
          </div>
          <span className="text-border flex h-5 items-center text-[13px] leading-none" aria-hidden>
            /
          </span>
          <span className="text-foreground flex h-5 max-w-52 items-center truncate text-[13px] leading-none font-medium">
            {project.name}
          </span>
          <span className="bg-muted text-muted-foreground ml-0.5 flex h-5 items-center rounded-none px-1.5 font-mono text-[11px] leading-none">
            {branchName}
          </span>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <PresenceBar
            channel={`presence:project:${project.id}`}
            self={{ userId: user.id, name: user.name, avatarUrl: user.avatarUrl }}
          />
          <ShareButton
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            projectId={project.id}
            projectName={project.name}
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
        <main className="relative min-w-0 flex-1 overflow-auto">
          <div className="pointer-events-none sticky top-0 -mb-[100dvh] h-[100dvh] w-full">
            <InteractiveDotField gap={16} radius={52} />
          </div>
          <div className="relative z-10 h-full">{children}</div>
        </main>
        <ChatSidebar />
      </div>

      <Suspense fallback={<footer className="bg-card/60 h-11 shrink-0 border-t" />}>
        <ProcessFooter base={base} stageStatuses={stageStatuses} workspaceSlug={workspace.slug} />
      </Suspense>
    </div>
  );
}

/** Compact workspace dropdown living inside the breadcrumb. */
function HeaderWorkspaceMenu({
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
    <div ref={ref} className="relative flex h-full items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-muted-foreground hover:text-foreground flex h-5 max-w-full items-center gap-1 text-[13px] leading-none transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate leading-none">{current.name}</span>
        <ChevronsUpDown className="size-3 shrink-0 opacity-70" />
      </button>
      {open ? (
        <div
          role="listbox"
          className="bg-popover absolute top-full left-0 z-50 mt-1.5 w-56 overflow-hidden rounded-none border shadow-lg"
        >
          <div className="max-h-64 overflow-y-auto p-1">
            {workspaces.map((w) => (
              <Link
                key={w.id}
                href={`/w/${w.slug}`}
                className="hover:bg-muted flex items-center gap-2 rounded-none px-2 py-1.5 text-sm"
                onClick={() => setOpen(false)}
              >
                <SignalIconTile kind="workspace" seed={w.id} letter={w.name} className="size-5" />
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === current.id ? <Check className="text-primary size-3.5" /> : null}
              </Link>
            ))}
          </div>
          <div className="border-t p-1">
            <Link
              href="/workspaces?manage=1"
              className="text-muted-foreground hover:bg-muted flex items-center gap-2 rounded-none px-2 py-1.5 text-sm"
              onClick={() => setOpen(false)}
            >
              <Plus className="size-3.5" /> Manage workspaces
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProjectShell(props: ProjectShellProps) {
  return (
    <CopilotProvider
      projectId={props.project.id}
      branchId={props.branchId}
      channels={props.chatChannels}
      categories={props.chatCategories}
      defaultChannelId={props.defaultChannelId}
      initialMessages={props.initialChatMessages}
    >
      <ShellInner {...props} />
    </CopilotProvider>
  );
}
