"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { GitBranch, PanelRightClose, PanelRightOpen, Settings } from "lucide-react";
import type { UIMessage } from "ai";
import type { Stage } from "@foundry/domain";
import { Button } from "@/components/ui/button";
import { FoundryMark } from "@/components/foundry-mark";
import { PresenceBar } from "@/components/presence-bar";
import { ReleaseChip } from "@/components/release-drawer";
import { ShareButton } from "@/components/share-button";
import {
  CopilotProvider,
  useCopilotShell,
  type ChatCategory,
  type ChatChannel,
} from "@/components/copilot/copilot-provider";
import { ChatSidebar } from "@/components/copilot/chat-sidebar";
import { DiscordChat } from "@/components/copilot/discord-chat";
import { CommandPalette } from "@/components/command-palette";
import { WorkspaceSwitcher, type ShellWorkspace } from "@/components/workspace-switcher";
export type { ShellWorkspace } from "@/components/workspace-switcher";

export type ProjectShellProps = {
  workspaces: ShellWorkspace[];
  workspace: ShellWorkspace;
  project: { id: string; name: string; slug: string };
  branchId: string;
  branchName: string;
  branchIsDefault?: boolean;
  stageStatuses: Record<Stage, string>;
  user: { id: string; name: string; avatarUrl?: string | null };
  chatChannels: ChatChannel[];
  chatCategories: ChatCategory[];
  defaultChannelId: string;
  initialChatMessages: UIMessage[];
  children: ReactNode;
};

function ShellInner({
  workspaces,
  workspace,
  project,
  branchId,
  branchName,
  branchIsDefault = false,
  user,
  children,
}: Omit<ProjectShellProps, "initialChatMessages">) {
  const pathname = usePathname();
  const { open, setOpen } = useCopilotShell();
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
            <WorkspaceSwitcher workspaces={workspaces} current={workspace} compact />
          </div>
          <span
            className="text-muted-foreground/50 hidden h-5 items-center font-mono text-[13px] leading-none md:flex"
            aria-hidden
          >
            /
          </span>
          <h1 className="flex h-5 min-w-0 max-w-52 items-center">
            <Link
              href={`${base}/overview`}
              title={project.name}
              className="text-foreground hover:text-primary flex h-5 items-center truncate text-[13px] leading-none font-medium"
            >
              {project.name}
            </Link>
          </h1>
          {branchIsDefault ? null : (
            <span
              className="bg-muted text-muted-foreground ml-0.5 flex h-5 min-w-0 max-w-40 items-center gap-1 rounded-none px-1.5 font-mono text-[11px] leading-none whitespace-nowrap"
              title={`Branch: ${branchName}`}
            >
              <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{branchName}</span>
            </span>
          )}
        </nav>
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
