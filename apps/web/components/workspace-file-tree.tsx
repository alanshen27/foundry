"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Boxes, Folder, FolderOpen, FolderPlus, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FolderColorPicker } from "@/components/folder-color-picker";
import { MoveToFolderDialog } from "@/components/move-to-folder-dialog";
import { folderColorStyle, type FolderColor } from "@/lib/folder-color";
import { buildFolderTree, type FolderNode, type FolderRef } from "@/lib/workspace-folders";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export type TreeProject = {
  id: string;
  name: string;
  slug: string;
  folderId?: string | null;
};

export type TreeFolder = FolderRef;

type Creating =
  { kind: "folder"; parentId: string | null } | { kind: "project"; parentId: string | null } | null;

function FolderRow({
  folder,
  depth,
  workspaceSlug,
  projects,
  expanded,
  onToggle,
  activeFolderId,
  creating,
  onStartCreate,
  onCancelCreate,
  onCreateFolder,
  createFolderPending,
  menuFor,
  onMenuFor,
  onRename,
  onMove,
  onDelete,
  onMoveProject,
  onSetColor,
}: {
  folder: FolderNode;
  depth: number;
  workspaceSlug: string;
  projects: TreeProject[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  activeFolderId: string | null;
  creating: Creating;
  onStartCreate: (kind: "folder" | "project", parentId: string | null) => void;
  onCancelCreate: () => void;
  onCreateFolder: (parentId: string | null, name: string) => void;
  createFolderPending: boolean;
  menuFor: string | null;
  onMenuFor: (id: string | null) => void;
  onRename: (folder: FolderRef) => void;
  onMove: (folder: FolderRef) => void;
  onDelete: (folder: FolderRef) => void;
  onMoveProject: (project: TreeProject) => void;
  onSetColor: (folder: FolderRef, color: FolderColor | null) => void;
}) {
  const pathname = usePathname();
  const open = expanded.has(folder.id);
  const childProjects = projects.filter((p) => p.folderId === folder.id);
  // Match HomeShell nav / root project rows (px-2.5); nest without a caret gutter.
  const pad = 10 + depth * 12;
  const href = `/w/${workspaceSlug}/folders/${folder.id}`;
  const active = activeFolderId === folder.id;
  const color = folderColorStyle(folder.color, folder.id);

  return (
    <div>
      <div
        className={cn(
          "group flex w-full items-center gap-0.5 rounded-none py-[7px] pr-0.5 text-[13px] transition-colors",
          active
            ? "bg-sidebar-accent text-foreground font-medium"
            : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
        )}
        style={{ paddingLeft: pad }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <button
            type="button"
            onClick={() => onToggle(folder.id)}
            className={cn("flex shrink-0 items-center justify-center", color.icon)}
            aria-label={open ? "Collapse folder" : "Expand folder"}
            aria-expanded={open}
            title={open ? "Collapse" : "Expand"}
          >
            {open ? (
              <FolderOpen className="size-[15px] fill-current" strokeWidth={1.75} />
            ) : (
              <Folder className="size-[15px] fill-current" strokeWidth={1.5} />
            )}
          </button>
          <Link href={href} className="min-w-0 flex-1 truncate">
            {folder.name}
          </Link>
        </div>
        <button
          type="button"
          title="New in folder"
          aria-label={`New in ${folder.name}`}
          onClick={() => onStartCreate("folder", folder.id)}
          className="hover:bg-muted flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Plus className="size-3" />
        </button>
        <div className="relative">
          <button
            type="button"
            title="Folder actions"
            aria-label={`Actions for ${folder.name}`}
            aria-expanded={menuFor === folder.id}
            onClick={() => onMenuFor(menuFor === folder.id ? null : folder.id)}
            className={cn(
              "hover:bg-muted flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100",
              menuFor === folder.id && "opacity-100",
            )}
          >
            <MoreHorizontal className="size-3" />
          </button>
          {menuFor === folder.id ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Close menu"
                onClick={() => onMenuFor(null)}
              />
              <div className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-0.5 min-w-[168px] rounded-none border py-1 text-[12px] shadow-md">
                <button
                  type="button"
                  className="hover:bg-muted w-full px-2.5 py-1.5 text-left"
                  onClick={() => {
                    onStartCreate("folder", folder.id);
                    onMenuFor(null);
                  }}
                >
                  New folder
                </button>
                <button
                  type="button"
                  className="hover:bg-muted w-full px-2.5 py-1.5 text-left"
                  onClick={() => {
                    onStartCreate("project", folder.id);
                    onMenuFor(null);
                  }}
                >
                  New project
                </button>
                <button
                  type="button"
                  className="hover:bg-muted w-full px-2.5 py-1.5 text-left"
                  onClick={() => {
                    onRename(folder);
                    onMenuFor(null);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="hover:bg-muted w-full px-2.5 py-1.5 text-left"
                  onClick={() => {
                    onMove(folder);
                    onMenuFor(null);
                  }}
                >
                  Move to…
                </button>
                <button
                  type="button"
                  className="text-destructive hover:bg-muted w-full px-2.5 py-1.5 text-left"
                  onClick={() => {
                    onDelete(folder);
                    onMenuFor(null);
                  }}
                >
                  Delete
                </button>
                <FolderColorPicker
                  selected={folder.color}
                  onSelect={(next) => {
                    onSetColor(folder, next);
                    onMenuFor(null);
                  }}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>

      {open ? (
        <div>
          {folder.children.map((child) => (
            <FolderRow
              key={child.id}
              folder={child}
              depth={depth + 1}
              workspaceSlug={workspaceSlug}
              projects={projects}
              expanded={expanded}
              onToggle={onToggle}
              activeFolderId={activeFolderId}
              creating={creating}
              onStartCreate={onStartCreate}
              onCancelCreate={onCancelCreate}
              onCreateFolder={onCreateFolder}
              createFolderPending={createFolderPending}
              menuFor={menuFor}
              onMenuFor={onMenuFor}
              onRename={onRename}
              onMove={onMove}
              onDelete={onDelete}
              onMoveProject={onMoveProject}
              onSetColor={onSetColor}
            />
          ))}
          {childProjects.map((project) => {
            const projectHref = `/w/${workspaceSlug}/projects/${project.slug}/engineer`;
            const projectActive = pathname?.startsWith(
              `/w/${workspaceSlug}/projects/${project.slug}`,
            );
            const projectMenuId = `p:${project.id}`;
            return (
              <div
                key={project.id}
                className={cn(
                  "group flex items-center gap-1 rounded-none py-[7px] pr-0.5 text-[13px] transition-colors",
                  projectActive
                    ? "bg-sidebar-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                )}
                style={{ paddingLeft: pad + 12 }}
              >
                <Link href={projectHref} className="flex min-w-0 flex-1 items-center gap-2.5">
                  <Boxes className="size-[15px] shrink-0 opacity-70" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                </Link>
                <div className="relative">
                  <button
                    type="button"
                    title="Project actions"
                    aria-label={`Actions for ${project.name}`}
                    onClick={() => onMenuFor(menuFor === projectMenuId ? null : projectMenuId)}
                    className={cn(
                      "hover:bg-muted flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100",
                      menuFor === projectMenuId && "opacity-100",
                    )}
                  >
                    <MoreHorizontal className="size-3" />
                  </button>
                  {menuFor === projectMenuId ? (
                    <>
                      <button
                        type="button"
                        className="fixed inset-0 z-40 cursor-default"
                        aria-label="Close menu"
                        onClick={() => onMenuFor(null)}
                      />
                      <div className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-0.5 min-w-[140px] rounded-none border py-1 text-[12px] shadow-md">
                        <button
                          type="button"
                          className="hover:bg-muted w-full px-2.5 py-1.5 text-left"
                          onClick={() => {
                            onMoveProject(project);
                            onMenuFor(null);
                          }}
                        >
                          Move to…
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
          {creating?.kind === "folder" && creating.parentId === folder.id ? (
            <NewFolderInline
              depth={depth + 1}
              pending={createFolderPending}
              onCancel={onCancelCreate}
              onSubmit={(name) => onCreateFolder(folder.id, name)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NewFolderInline({
  depth,
  pending,
  onCancel,
  onSubmit,
}: {
  depth: number;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className="flex items-center gap-2.5 py-1 pr-2"
      style={{ paddingLeft: 10 + depth * 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
    >
      <Folder
        className="text-muted-foreground size-[15px] shrink-0 opacity-70"
        strokeWidth={1.75}
      />
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Folder name"
        aria-label="Folder name"
        className="h-7 text-[12px]"
        disabled={pending}
      />
    </form>
  );
}

export function WorkspaceFileTree({
  workspaceId,
  workspaceSlug,
  projects,
  folders,
}: {
  workspaceId: string;
  workspaceSlug: string;
  projects: TreeProject[];
  folders: TreeFolder[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folders.map((f) => f.id)));
  const [creating, setCreating] = useState<Creating>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renameFolder, setRenameFolder] = useState<FolderRef | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveFolder, setMoveFolder] = useState<FolderRef | null>(null);
  const [moveProject, setMoveProject] = useState<TreeProject | null>(null);
  const [projectParentId, setProjectParentId] = useState<string | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");

  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const rootProjects = projects.filter((p) => !p.folderId);

  const activeFolderId = useMemo(() => {
    const prefix = `/w/${workspaceSlug}/folders/`;
    if (!pathname?.startsWith(prefix)) return null;
    const rest = pathname.slice(prefix.length);
    return rest.split("/")[0] || null;
  }, [pathname, workspaceSlug]);

  const createFolder = trpc.folder.create.useMutation({
    onSuccess: (folder) => {
      setExpanded(
        (prev) => new Set([...prev, folder.id, ...(folder.parentId ? [folder.parentId] : [])]),
      );
      setCreating(null);
      router.refresh();
    },
  });
  const createProject = trpc.project.create.useMutation({
    onSuccess: (project) => {
      setProjectDialogOpen(false);
      setProjectName("");
      setCreating(null);
      router.push(`/w/${workspaceSlug}/projects/${project.slug}/engineer`);
      router.refresh();
    },
  });
  const renameMut = trpc.folder.rename.useMutation({
    onSuccess: () => {
      setRenameFolder(null);
      router.refresh();
    },
  });
  const deleteMut = trpc.folder.delete.useMutation({
    onSuccess: () => router.refresh(),
  });
  const moveFolderMut = trpc.folder.move.useMutation({
    onSuccess: () => {
      setMoveFolder(null);
      router.refresh();
    },
  });
  const moveProjectMut = trpc.project.moveToFolder.useMutation({
    onSuccess: () => {
      setMoveProject(null);
      router.refresh();
    },
  });
  const setColorMut = trpc.folder.setColor.useMutation({
    onSuccess: () => router.refresh(),
  });

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startCreate(kind: "folder" | "project", parentId: string | null) {
    if (kind === "project") {
      setProjectParentId(parentId);
      setProjectDialogOpen(true);
      setCreating(null);
      if (parentId) setExpanded((prev) => new Set([...prev, parentId]));
      return;
    }
    setCreating({ kind, parentId });
    if (parentId) setExpanded((prev) => new Set([...prev, parentId]));
  }

  function submitProject(e: FormEvent) {
    e.preventDefault();
    if (!projectName.trim()) return;
    createProject.mutate({
      workspaceId,
      name: projectName.trim(),
      folderId: projectParentId,
    });
  }

  const empty = folders.length === 0 && projects.length === 0;

  return (
    <div className="mt-1 min-h-0 shrink-0" role="tree" aria-label="Projects and folders">
      <div className="mb-0.5 flex items-center justify-end gap-0.5 px-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="New folder"
          aria-label="New folder"
          onClick={() => startCreate("folder", null)}
        >
          <FolderPlus className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="New project"
          aria-label="New project"
          onClick={() => startCreate("project", null)}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      {empty && !creating ? (
        <p className="text-muted-foreground px-2.5 py-1.5 text-[13px]">No projects yet</p>
      ) : null}

      {tree.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          depth={0}
          workspaceSlug={workspaceSlug}
          projects={projects}
          expanded={expanded}
          onToggle={toggle}
          activeFolderId={activeFolderId}
          creating={creating}
          onStartCreate={startCreate}
          onCancelCreate={() => setCreating(null)}
          onCreateFolder={(parentId, name) => createFolder.mutate({ workspaceId, name, parentId })}
          createFolderPending={createFolder.isPending}
          menuFor={menuFor}
          onMenuFor={setMenuFor}
          onRename={(f) => {
            setRenameFolder(f);
            setRenameValue(f.name);
          }}
          onMove={setMoveFolder}
          onDelete={(f) => {
            if (confirm(`Delete “${f.name}”? Projects and subfolders move up one level.`)) {
              deleteMut.mutate({ folderId: f.id });
            }
          }}
          onMoveProject={setMoveProject}
          onSetColor={(f, color) => setColorMut.mutate({ folderId: f.id, color })}
        />
      ))}

      {rootProjects.map((project) => {
        const href = `/w/${workspaceSlug}/projects/${project.slug}/engineer`;
        const active = pathname?.startsWith(`/w/${workspaceSlug}/projects/${project.slug}`);
        const projectMenuId = `p:${project.id}`;
        return (
          <div
            key={project.id}
            className={cn(
              "group flex items-center gap-1 rounded-none px-2.5 py-[7px] text-[13px] transition-colors",
              active
                ? "bg-sidebar-accent text-foreground font-medium"
                : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
            )}
          >
            <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5">
              <Boxes className="size-[15px] shrink-0 opacity-70" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
            </Link>
            <div className="relative">
              <button
                type="button"
                title="Project actions"
                aria-label={`Actions for ${project.name}`}
                onClick={() => setMenuFor(menuFor === projectMenuId ? null : projectMenuId)}
                className={cn(
                  "hover:bg-muted flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100",
                  menuFor === projectMenuId && "opacity-100",
                )}
              >
                <MoreHorizontal className="size-3" />
              </button>
              {menuFor === projectMenuId ? (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default"
                    aria-label="Close menu"
                    onClick={() => setMenuFor(null)}
                  />
                  <div className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-0.5 min-w-[140px] rounded-none border py-1 text-[12px] shadow-md">
                    <button
                      type="button"
                      className="hover:bg-muted w-full px-2.5 py-1.5 text-left"
                      onClick={() => {
                        setMoveProject(project);
                        setMenuFor(null);
                      }}
                    >
                      Move to…
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        );
      })}

      {creating?.kind === "folder" && creating.parentId === null ? (
        <NewFolderInline
          depth={0}
          pending={createFolder.isPending}
          onCancel={() => setCreating(null)}
          onSubmit={(name) => createFolder.mutate({ workspaceId, name, parentId: null })}
        />
      ) : null}

      {createFolder.error ? (
        <p className="text-destructive px-2.5 py-1 text-[11px]">{createFolder.error.message}</p>
      ) : null}

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              {projectParentId
                ? "Create a project in this folder."
                : "Create a project at the workspace root."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitProject} className="flex flex-col gap-3">
            <Input
              autoFocus
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Project name"
              aria-label="Project name"
              required
            />
            {createProject.error ? (
              <p className="text-destructive text-[12px]">{createProject.error.message}</p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProjectDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createProject.isPending || !projectName.trim()}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renameFolder)}
        onOpenChange={(open) => {
          if (!open) setRenameFolder(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (renameFolder && renameValue.trim()) {
                renameMut.mutate({ folderId: renameFolder.id, name: renameValue.trim() });
              }
            }}
            className="flex flex-col gap-3"
          >
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              aria-label="Folder name"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameFolder(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={renameMut.isPending || !renameValue.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <MoveToFolderDialog
        open={Boolean(moveFolder)}
        onOpenChange={(open) => {
          if (!open) setMoveFolder(null);
        }}
        folders={folders}
        title="Move folder"
        description={moveFolder ? `Move “${moveFolder.name}” to another location.` : undefined}
        excludeFolderId={moveFolder?.id}
        currentFolderId={moveFolder?.parentId ?? null}
        pending={moveFolderMut.isPending}
        onMove={(parentId) => {
          if (moveFolder) moveFolderMut.mutate({ folderId: moveFolder.id, parentId });
        }}
      />

      <MoveToFolderDialog
        open={Boolean(moveProject)}
        onOpenChange={(open) => {
          if (!open) setMoveProject(null);
        }}
        folders={folders}
        title="Move project"
        description={moveProject ? `Move “${moveProject.name}” to a folder.` : undefined}
        currentFolderId={moveProject?.folderId ?? null}
        pending={moveProjectMut.isPending}
        onMove={(folderId) => {
          if (moveProject) {
            moveProjectMut.mutate({ projectId: moveProject.id, folderId });
          }
        }}
      />
    </div>
  );
}
