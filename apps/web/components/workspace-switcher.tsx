"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { SignalIconTile } from "@/components/signal-icons";
import { cn } from "@/lib/utils";

const WorkspaceManager = dynamic(
  () => import("@/components/workspace-manager").then((module) => module.WorkspaceManager),
  { ssr: false },
);

export type ShellWorkspace = { id: string; name: string; slug: string };

export function WorkspaceSwitcher({
  workspaces,
  current,
  compact = false,
}: {
  workspaces: ShellWorkspace[];
  current: ShellWorkspace;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [savedWorkspaces, setSavedWorkspaces] = useState<ShellWorkspace[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const choices = workspaces.map(
    (workspace) => savedWorkspaces.find((saved) => saved.id === workspace.id) ?? workspace,
  );
  for (const saved of savedWorkspaces) {
    if (!choices.some((workspace) => workspace.id === saved.id)) choices.push(saved);
  }
  const selected = choices.find((workspace) => workspace.id === current.id) ?? current;

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <>
      <div
        ref={ref}
        className={cn("relative", compact && "flex h-full items-center")}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
          }
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
            compact
              ? "text-muted-foreground hover:text-foreground flex h-5 max-w-full items-center gap-1 font-mono text-[11px] leading-none"
              : "hover:bg-muted flex w-full items-center gap-2.5 rounded-none px-2 py-1.5 text-left",
          )}
          aria-label={`Switch workspace, ${selected.name}`}
          aria-expanded={open}
          aria-controls={menuId}
        >
          {compact ? (
            <span className="truncate leading-none">{selected.name}</span>
          ) : (
            <>
              <SignalIconTile
                kind="workspace"
                seed={selected.id}
                letter={selected.name}
                className="size-6"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{selected.name}</span>
                <span className="text-muted-foreground block font-mono text-[10px] tracking-[0.08em] uppercase">
                  Workspace
                </span>
              </span>
            </>
          )}
          <ChevronsUpDown
            className={cn(
              "text-muted-foreground shrink-0",
              compact ? "size-3 opacity-70" : "size-3.5",
            )}
          />
        </button>

        {open ? (
          <div
            id={menuId}
            className={cn(
              "bg-popover absolute top-full z-50 mt-1 overflow-hidden rounded-none border shadow-[var(--shadow-panel)]",
              compact ? "left-0 mt-1.5 w-56" : "inset-x-0",
            )}
          >
            <nav aria-label="Workspaces" className="max-h-64 overflow-y-auto p-1">
              {choices.map((workspace) => (
                <Link
                  key={workspace.id}
                  href={`/w/${workspace.slug}`}
                  className="hover:bg-muted focus-visible:bg-muted flex items-center gap-2 rounded-none px-2 py-1.5 text-[13px] outline-none"
                  aria-current={workspace.id === current.id ? "true" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <SignalIconTile
                    kind="workspace"
                    seed={workspace.id}
                    letter={workspace.name}
                    className="size-5"
                  />
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  {workspace.id === current.id ? <Check className="text-primary size-3.5" /> : null}
                </Link>
              ))}
            </nav>
            <div className="border-t p-1">
              <button
                type="button"
                className="text-muted-foreground hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left text-[13px] outline-none"
                onClick={() => {
                  setOpen(false);
                  setManageOpen(true);
                }}
              >
                <Plus className="size-3.5" /> Manage workspaces
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {manageOpen ? (
        <WorkspaceManager
          open={manageOpen}
          onOpenChange={(value) => {
            setManageOpen(value);
            if (!value) triggerRef.current?.focus();
          }}
          workspaces={choices}
          current={selected}
          onWorkspaceChanged={(workspace) => {
            setSavedWorkspaces((saved) => [
              ...saved.filter((item) => item.id !== workspace.id),
              workspace,
            ]);
          }}
        />
      ) : null}
    </>
  );
}
