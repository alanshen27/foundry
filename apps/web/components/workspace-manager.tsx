"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { ArrowUpRight, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SignalIconTile } from "@/components/signal-icons";
import type { ShellWorkspace } from "@/components/workspace-switcher";
import { trpc } from "@/lib/trpc";

type ManagedWorkspace = ShellWorkspace & { canManage: boolean };

type WorkspaceManagerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: ShellWorkspace[];
  current?: ShellWorkspace;
  onWorkspaceChanged?: (workspace: ShellWorkspace) => void;
};

function mutationMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

/** Names and creation stay here; opening a workspace is always an explicit action. */
export function WorkspaceManager({ open, onOpenChange, ...props }: WorkspaceManagerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(680px,calc(100dvh-2rem))] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {open ? (
          <WorkspaceManagerContent
            {...props}
            open={open}
            onOpenWorkspace={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceManagerContent({
  open,
  workspaces,
  current,
  onWorkspaceChanged,
  onOpenWorkspace,
}: Omit<WorkspaceManagerProps, "onOpenChange"> & { onOpenWorkspace: () => void }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const list = trpc.workspace.list.useQuery(undefined, { enabled: open });
  const create = trpc.workspace.create.useMutation();
  const [savedWorkspaces, setSavedWorkspaces] = useState<ShellWorkspace[]>([]);
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const nameId = useId();

  // Keep successful changes visible even while a refresh is in flight. The
  // fetched list remains authoritative for permissions; fallback labels cannot
  // grant rename access.
  const rows: ManagedWorkspace[] = (
    list.data ?? workspaces.map((workspace) => ({ ...workspace, canManage: false }))
  ).map((workspace) => {
    const saved = savedWorkspaces.find((item) => item.id === workspace.id);
    return saved ? { ...workspace, name: saved.name, slug: saved.slug } : workspace;
  });
  for (const saved of savedWorkspaces) {
    if (!rows.some((workspace) => workspace.id === saved.id)) {
      rows.push({ ...saved, canManage: true });
    }
  }

  function remember(workspace: ShellWorkspace) {
    setSavedWorkspaces((saved) => [...saved.filter((item) => item.id !== workspace.id), workspace]);
    onWorkspaceChanged?.(workspace);
    void utils.workspace.list.invalidate();
    router.refresh();
  }

  function onRenamed(workspace: ShellWorkspace) {
    utils.workspace.list.setData(undefined, (previous) =>
      previous?.map((item) => (item.id === workspace.id ? { ...item, ...workspace } : item)),
    );
    remember(workspace);
    setNotice(`Renamed to ${workspace.name}.`);
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || create.isPending) return;
    setCreateError(null);
    setNotice(null);
    try {
      const workspace = await create.mutateAsync({ name: name.trim() });
      utils.workspace.list.setData(undefined, (previous) =>
        previous
          ? [
              ...previous.filter((item) => item.id !== workspace.id),
              { ...workspace, canManage: true, _count: { projects: 0, memberships: 1 } },
            ]
          : previous,
      );
      remember(workspace);
      setName("");
      setNotice(`${workspace.name} is ready.`);
    } catch (error) {
      setCreateError(mutationMessage(error));
    }
  }

  return (
    <>
      <DialogHeader className="border-b px-5 py-5 pr-12">
        <DialogTitle className="font-sans text-lg tracking-tight">Manage workspaces</DialogTitle>
        <DialogDescription className="text-[13px]">
          Rename a workspace or create a new home for your projects.
        </DialogDescription>
      </DialogHeader>

      <div className="px-5 pt-4 pb-2">
        <div className="text-muted-foreground mb-3 flex items-center justify-between font-mono text-[10px] tracking-[0.1em] uppercase">
          <span>Your workspaces</span>
          {list.isLoading ? (
            <span role="status" className="flex items-center gap-1.5 normal-case tracking-normal">
              <Loader2 className="size-3 animate-spin" /> Loading…
            </span>
          ) : null}
        </div>
        {list.error ? (
          <div className="border-destructive/30 bg-destructive/5 mb-3 flex items-center gap-3 border px-3 py-2">
            <p role="alert" className="text-destructive flex-1 text-xs">
              Could not load workspaces. {list.error.message}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={list.isFetching}
              onClick={() => void list.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : null}
        <div className="divide-border divide-y">
          {rows.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              isCurrent={workspace.id === current?.id}
              onRenamed={onRenamed}
              onOpenWorkspace={onOpenWorkspace}
            />
          ))}
        </div>
        {!list.isLoading && !list.error && rows.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">Create your first workspace below.</p>
        ) : null}
        <p role="status" className="text-muted-foreground min-h-7 pt-2 text-xs">
          {notice}
        </p>
      </div>

      <form
        aria-label="Create workspace"
        onSubmit={submitCreate}
        className="bg-muted/25 border-t px-5 py-4"
      >
        <label htmlFor={nameId} className="mb-2 block text-[13px] font-medium">
          New workspace
        </label>
        <div className="flex items-center gap-2">
          <Input
            id={nameId}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setCreateError(null);
            }}
            placeholder="Workspace name"
            maxLength={80}
            required
            disabled={create.isPending}
            aria-invalid={Boolean(createError)}
            aria-describedby={createError ? `${nameId}-error` : undefined}
            className="h-9 bg-card"
          />
          <Button type="submit" className="h-9 px-3" disabled={!name.trim() || create.isPending}>
            {create.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
        {createError ? (
          <p id={`${nameId}-error`} role="alert" className="text-destructive mt-2 text-xs">
            {createError}
          </p>
        ) : null}
      </form>
    </>
  );
}

function WorkspaceRow({
  workspace,
  isCurrent,
  onRenamed,
  onOpenWorkspace,
}: {
  workspace: ManagedWorkspace;
  isCurrent: boolean;
  onRenamed: (workspace: ShellWorkspace) => void;
  onOpenWorkspace: () => void;
}) {
  const rename = trpc.workspace.rename.useMutation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();

  function cancel() {
    setEditing(false);
    setName(workspace.name);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!workspace.canManage || !name.trim() || rename.isPending) return;
    setError(null);
    try {
      const renamed = await rename.mutateAsync({ workspaceId: workspace.id, name: name.trim() });
      onRenamed(renamed);
      setEditing(false);
    } catch (error) {
      setError(mutationMessage(error));
    }
  }

  return (
    <div className="py-3" data-workspace-id={workspace.id}>
      {editing && workspace.canManage ? (
        <form aria-label={`Rename ${workspace.name}`} onSubmit={submit}>
          <label htmlFor={nameId} className="sr-only">
            Workspace name for {workspace.name}
          </label>
          <Input
            id={nameId}
            autoFocus
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !rename.isPending) {
                event.stopPropagation();
                cancel();
              }
            }}
            maxLength={80}
            required
            disabled={rename.isPending}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${nameId}-error` : undefined}
            className="h-9"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={rename.isPending}
              onClick={cancel}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={rename.isPending || !name.trim() || name.trim() === workspace.name}
            >
              {rename.isPending ? <Loader2 className="size-3 animate-spin" /> : null}
              {rename.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
          {error ? (
            <p id={`${nameId}-error`} role="alert" className="text-destructive mt-2 text-xs">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <SignalIconTile
            kind="workspace"
            seed={workspace.id}
            letter={workspace.name}
            className="size-8 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{workspace.name}</p>
            <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
              {isCurrent ? "Current workspace" : `/${workspace.slug}`}
            </p>
          </div>
          {workspace.canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Rename ${workspace.name}`}
              onClick={() => {
                setName(workspace.name);
                setError(null);
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
          <Link
            href={`/w/${workspace.slug}`}
            onClick={onOpenWorkspace}
            aria-label={`Open workspace ${workspace.name}`}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-7 shrink-0 items-center gap-1 px-1 text-xs outline-none focus-visible:ring-1"
          >
            Open <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
