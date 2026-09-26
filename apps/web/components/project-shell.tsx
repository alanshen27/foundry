"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronsUpDown,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings,
} from "lucide-react";
import type { UIMessage } from "ai";
import type { Stage } from "@foundry/domain";
import { Button } from "@/components/ui/button";
import { FoundryMark } from "@/components/foundry-mark";
import { PresenceBar } from "@/components/presence-bar";
import { ReleaseChip } from "@/components/release-drawer";
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
import { StageRail } from "@/components/stage-rail";
import { CommandPalette } from "@/components/command-palette";
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

function ShellInner({
  workspaces,
  workspace,
  project,
  branchId,
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
    <div data-workspace-shell className="bg-background flex h-dvh flex-col overflow-hidden">
      <CommandPalette basePath={base} projectId={project.id} branchId={branchId} />
      <header className="bg-card relative z-20 flex h-11 shrink-0 items-center gap-1.5 border-b px-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
          <Link
            href={`/w/${workspace.slug}`}
            aria-label="Workspace home"
            className="text-foreground flex shrink-0 items-center justify-center pr-1.5"
          >
            <FoundryMark size="sm" className="[&>span]:hidden lg:[&>span]:inline" />
          </Link>
          <span
            className="text-muted-foreground/50 flex h-5 items-center font-mono text-[13px] leading-none"
            aria-hidden
          >
            /
          </span>
          <div className="hidden h-5 min-w-0 max-w-36 items-center md:flex">
            <HeaderWorkspaceMenu workspaces={workspaces} current={workspace} />
          </div>
          <span
            className="text-muted-foreground/50 hidden h-5 items-center font-mono text-[13px] leading-none md:flex"
            aria-hidden
          >
            /
          </span>
          <h1 className="flex h-5 max-w-52 items-center">
            <Link
              href={`${base}/overview`}
              title={project.name}
              className="text-foreground hover:text-primary flex h-5 items-center truncate text-[13px] leading-none font-medium"
            >
              {project.name}
            </Link>
          </h1>
          <span
            className="bg-muted text-muted-foreground ml-0.5 flex h-5 items-center rounded-none px-1.5 font-mono text-[11px] leading-none"
            title={branchName}
          >
            {branchName}
          </span>
        </nav>
        <StageRail basePath={base} stageStatuses={stageStatuses} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ReleaseChip
            projectId={project.id}
            branchId={branchId}
            launchHref={`${base}/engineer?view=launch`}
          />
          <Link
            href={`/w/${workspace.slug}/settings`}
            title="Workspace settings"
            aria-label="Workspace settings"
            className="text-muted-foreground hover:bg-muted hover:text-primary flex size-7 items-center justify-center rounded-none"
          >
            <Settings className="size-3.5" strokeWidth={1.75} />
          </Link>
          <PresenceBar
            channel={`presence:project:${project.id}`}
            self={{ userId: user.id, name: user.name, avatarUrl: user.avatarUrl }}
          />
          <ShareButton
            appearance="default"
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
            aria-expanded={open}
          >
            {open ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <main
          className="workspace-dot-field relative min-w-0 flex-1 overflow-auto"
          aria-label="Project workspace"
        >
          <div className="h-full">{children}</div>
        </main>
        <ChatSidebar />
      </div>
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
        className="text-muted-foreground hover:text-foreground flex h-5 max-w-full items-center gap-1 font-mono text-[11px] leading-none transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate leading-none">{current.name}</span>
        <ChevronsUpDown className="size-3 shrink-0 opacity-70" />
      </button>
      {open ? (
        <div
          role="listbox"
          className="bg-popover absolute top-full left-0 z-50 mt-1.5 w-56 overflow-hidden rounded-none border shadow-[var(--shadow-panel)]"
        >
          <div className="max-h-64 overflow-y-auto p-1">
            {workspaces.map((w) => (
              <Link
                key={w.id}
                href={`/w/${w.slug}`}
                className="hover:bg-muted flex items-center gap-2 rounded-none px-2 py-1.5 text-xs"
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
              className="text-muted-foreground hover:bg-muted flex items-center gap-2 rounded-none px-2 py-1.5 text-xs"
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
      viewer={props.user}
    >
      <ShellInner {...props} />
    </CopilotProvider>
  );
}
