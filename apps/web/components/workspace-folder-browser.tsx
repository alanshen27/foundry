"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Boxes,
  ChevronRight,
  Folder,
  FolderKanban,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { ShareButton } from "@/components/share-button";
import { avatarColor } from "@/lib/avatar-color";
import { folderColorStyle, type FolderColor } from "@/lib/folder-color";
import { childFolders, folderBreadcrumbs, type FolderRef } from "@/lib/workspace-folders";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const STAGES = ["IDEATE", "ENGINEER", "VERIFY", "LAUNCH"] as const;

const STAGE_DOT: Record<string, string> = {
  NOT_STARTED: "bg-muted-foreground/30",
  DRAFT: "bg-sky-500",
  RUNNING: "bg-primary",
  NEEDS_REVIEW: "bg-amber-500",
  APPROVED: "bg-emerald-500",
  BLOCKED: "bg-red-500",
  STALE: "bg-orange-400",
};

export type BrowserProject = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  folderId?: string | null;
  stageStates: { stage: string; status: string }[];
  /** Cached 3D preview; null until the first render lands. */
  thumbnailUrl?: string | null;
  hasModel?: boolean;
  stale?: boolean;
};

/** One cell of a preview tile: the 3D render, or the project's tinted initial. */
function PreviewFace({ project, className }: { project: BrowserProject; className?: string }) {
  if (project.thumbnailUrl) {
    return (
      // Not next/image: these are authenticated proxy URLs, not optimizable assets.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={project.thumbnailUrl}
        alt=""
        // Slight zoom crops the empty margin Zoo leaves around the model so the
        // tile reads as filled rather than a tiny part floating in navy.
        className={cn("size-full scale-125 object-cover", className)}
        loading="lazy"
      />
    );
  }
  const color = avatarColor(project.id);
  return (
    <div className={cn("flex size-full items-center justify-center", color.tile, className)}>
      <span className="text-[1.6em] font-bold">{project.name.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

/**
 * Folders borrow the previews of the projects inside them, so a folder tile
 * shows what it holds rather than a lone icon on a wall of colour.
 */
function FolderPreview({
  folder,
  contents,
}: {
  folder: FolderRef;
  contents: BrowserProject[];
}) {
  const style = folderColorStyle(folder.color, folder.id);
  if (contents.length === 0) {
    return (
      <div className={cn("flex aspect-4/3 items-center justify-center", style.tile)}>
        <Folder
          className="size-10 transition-transform duration-150 group-hover:scale-110"
          strokeWidth={1.5}
        />
      </div>
    );
  }
  return (
    <div className={cn("relative aspect-4/3 text-2xl", style.tile)}>
      <div className="grid size-full grid-cols-2 grid-rows-2 gap-px transition-transform duration-150 group-hover:scale-105">
        {Array.from({ length: 4 }, (_, i) => {
          const project = contents[i];
          return (
            <div key={i} className="overflow-hidden text-[0.55em]">
              {project ? <PreviewFace project={project} /> : <div className="size-full" />}
            </div>
          );
        })}
      </div>
      {/* Folders and projects are both square tiles now, so mark which is which. */}
      <span
        className={cn(
          "bg-background absolute top-2 left-2 flex size-6 items-center justify-center rounded-md shadow-sm",
          style.icon,
        )}
      >
        <Folder className="size-3.5" strokeWidth={2} />
      </span>
    </div>
  );
}

/**
 * The 3D render if one has been cached, otherwise a tinted placeholder so the
 * grid stays even while previews trickle in.
 */
function ProjectPreview({
  project,
  rendering,
}: {
  project: BrowserProject;
  rendering: boolean;
}) {
  return (
    <div className="bg-muted relative aspect-4/3 overflow-hidden text-2xl">
      {/* Decorative: the card already spells out the project name below. */}
      <PreviewFace
        project={project}
        className="transition-transform duration-200 group-hover:scale-[1.35]"
      />
      {rendering ? (
        <div
          className="bg-background/70 absolute inset-0 flex items-center justify-center backdrop-blur-sm"
          title="Rendering 3D preview"
        >
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        </div>
      ) : null}
      {!project.hasModel && !project.thumbnailUrl ? (
        <span className="bg-background/70 text-muted-foreground absolute bottom-2 left-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm">
          <Boxes className="size-2.5" />
          No model yet
        </span>
      ) : null}
    </div>
  );
}

export function WorkspaceFolderBrowser({
  workspaceId,
  workspaceSlug,
  workspaceName,
  folderId,
  folders,
  projects,
}: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  folderId: string | null;
  folders: FolderRef[];
  projects: BrowserProject[];
}) {
  const router = useRouter();
  const attempted = useRef<Set<string>>(new Set());
  const [renderingIds, setRenderingIds] = useState<Set<string>>(() => new Set());
  const crumbs = useMemo(() => folderBreadcrumbs(folders, folderId), [folders, folderId]);
  const foldersHere = useMemo(() => childFolders(folders, folderId), [folders, folderId]);
  const projectsHere = useMemo(
    () =>
      projects
        .filter((p) => (p.folderId ?? null) === folderId)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [projects, folderId],
  );

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");

  const [renameFolder, setRenameFolder] = useState<FolderRef | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveFolder, setMoveFolder] = useState<FolderRef | null>(null);
  const [moveProject, setMoveProject] = useState<BrowserProject | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const createFolder = trpc.folder.create.useMutation({
    onSuccess: () => {
      setNewFolderOpen(false);
      setFolderName("");
      router.refresh();
    },
  });
  const createProject = trpc.project.create.useMutation({
    onSuccess: (project) => {
      setNewProjectOpen(false);
      setProjectName("");
      setProjectDescription("");
      router.push(`/w/${workspaceSlug}/projects/${project.slug}/overview`);
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
  const setColorMut = trpc.folder.setColor.useMutation({
    onSuccess: () => router.refresh(),
  });
  const refreshThumbnail = trpc.project.refreshThumbnail.useMutation();
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

  const empty = foldersHere.length === 0 && projectsHere.length === 0;
  const currentName = crumbs.length ? crumbs[crumbs.length - 1]!.name : workspaceName;

  // Fill in previews that are missing or out of date. Renders are slow and hit
  // a headless browser, so they run one at a time and only once per project per
  // mount — `attempted` also stops a failed render from retrying in a loop.
  const needsPreview = projectsHere
    .filter((p) => p.hasModel && (p.stale || !p.thumbnailUrl))
    .map((p) => p.id)
    .join(",");

  const renderPreview = useCallback(
    async (projectId: string) => {
      setRenderingIds((prev) => new Set(prev).add(projectId));
      try {
        await refreshThumbnail.mutateAsync({ projectId });
        router.refresh();
      } catch {
        // Leave the placeholder up; "Refresh preview" can retry by hand.
      } finally {
        setRenderingIds((prev) => {
          const next = new Set(prev);
          next.delete(projectId);
          return next;
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  );

  useEffect(() => {
    if (!needsPreview) return;
    let cancelled = false;

    (async () => {
      for (const id of needsPreview.split(",")) {
        if (cancelled) return;
        if (attempted.current.has(id)) continue;
        attempted.current.add(id);
        await renderPreview(id);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPreview]);

  /** "2 projects · 1 folder" — more useful on a card than the word "Folder". */
  function folderSummary(id: string) {
    const projectCount = projects.filter((p) => p.folderId === id).length;
    const folderCount = childFolders(folders, id).length;
    const parts: string[] = [];
    if (projectCount) parts.push(`${projectCount} project${projectCount === 1 ? "" : "s"}`);
    if (folderCount) parts.push(`${folderCount} folder${folderCount === 1 ? "" : "s"}`);
    return parts.length ? parts.join(" · ") : "Empty";
  }

  function submitFolder(e: FormEvent) {
    e.preventDefault();
    if (!folderName.trim()) return;
    createFolder.mutate({ workspaceId, name: folderName.trim(), parentId: folderId });
  }

  function submitProject(e: FormEvent) {
    e.preventDefault();
    if (!projectName.trim()) return;
    createProject.mutate({
      workspaceId,
      name: projectName.trim(),
      description: projectDescription.trim() || undefined,
      folderId,
    });
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-muted-foreground mb-2 flex flex-wrap items-center gap-1 text-[12px]">
            <Link href={`/w/${workspaceSlug}`} className="hover:text-foreground transition-colors">
              {workspaceName}
            </Link>
            {crumbs.map((c) => (
              <span key={c.id} className="flex items-center gap-1">
                <ChevronRight className="size-3 opacity-50" />
                <Link
                  href={`/w/${workspaceSlug}/folders/${c.id}`}
                  className={cn(
                    "hover:text-foreground transition-colors",
                    c.id === folderId && "text-foreground font-medium",
                  )}
                >
                  {c.name}
                </Link>
              </span>
            ))}
          </nav>
          <h1 className="text-[28px] font-semibold tracking-[-0.03em]">{currentName}</h1>
          <p className="text-muted-foreground mt-1 text-[13px]">
            {foldersHere.length} folder{foldersHere.length === 1 ? "" : "s"}
            {" · "}
            {projectsHere.length} project{projectsHere.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setNewFolderOpen(true)}
          >
            <FolderPlus className="size-3.5" />
            New folder
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={() => setNewProjectOpen(true)}
          >
            <Plus className="size-3.5" />
            New project
          </Button>
          {!folderId ? (
            <ShareButton workspaceId={workspaceId} workspaceName={workspaceName} variant="invite" />
          ) : null}
        </div>
      </div>

      {empty ? (
        <div className="bg-card flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center">
          <span className="bg-primary/10 text-primary mb-3 flex size-12 items-center justify-center rounded-2xl">
            <FolderKanban className="size-5" strokeWidth={2} />
          </span>
          <p className="text-[13px] font-medium">This folder is empty</p>
          <p className="text-muted-foreground mt-1 max-w-sm text-[13px]">
            Create a folder or project to organize work here.
          </p>
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setNewFolderOpen(true)}>
              New folder
            </Button>
            <Button type="button" size="sm" onClick={() => setNewProjectOpen(true)}>
              New project
            </Button>
          </div>
        </div>
      ) : (
        // Auto-fill off the container, not the viewport: with a sidebar in the
        // way, breakpoint columns guess the available width badly.
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
          {foldersHere.map((folder) => (
            <div key={folder.id} className="group relative">
              <Link href={`/w/${workspaceSlug}/folders/${folder.id}`} className="block">
                <Card className="hover:ring-foreground/15 gap-0 overflow-hidden rounded-2xl p-0 transition-all duration-150 group-hover:-translate-y-1 hover:shadow-[var(--shadow-panel)]">
                  <FolderPreview
                    folder={folder}
                    contents={projects.filter((p) => p.folderId === folder.id)}
                  />
                  <div className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[13px] font-semibold">{folder.name}</p>
                      <ArrowRight className="text-muted-foreground size-3 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                    </div>
                    <p className="text-muted-foreground truncate text-[11px]">
                      {folderSummary(folder.id)}
                    </p>
                  </div>
                </Card>
              </Link>
              <ItemMenu
                open={menuFor === `f:${folder.id}`}
                onOpenChange={(open) => setMenuFor(open ? `f:${folder.id}` : null)}
                color={folder.color}
                onSetColor={(color) => setColorMut.mutate({ folderId: folder.id, color })}
                onRename={() => {
                  setRenameFolder(folder);
                  setRenameValue(folder.name);
                  setMenuFor(null);
                }}
                onMove={() => {
                  setMoveFolder(folder);
                  setMenuFor(null);
                }}
                onDelete={() => {
                  if (
                    confirm(
                      `Delete “${folder.name}”? Projects and subfolders move up one level.`,
                    )
                  ) {
                    deleteMut.mutate({ folderId: folder.id });
                  }
                  setMenuFor(null);
                }}
              />
            </div>
          ))}

          {projectsHere.map((project) => (
            <div key={project.id} className="group relative">
              <Link
                href={`/w/${workspaceSlug}/projects/${project.slug}/overview`}
                className="block"
              >
                <Card className="hover:ring-foreground/15 gap-0 overflow-hidden rounded-2xl p-0 transition-all duration-150 group-hover:-translate-y-1 hover:shadow-[var(--shadow-panel)]">
                  <ProjectPreview
                    project={project}
                    rendering={renderingIds.has(project.id)}
                  />
                  <div className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[13px] font-semibold">{project.name}</p>
                      <ArrowRight className="text-muted-foreground size-3 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                    </div>
                    <p className="text-muted-foreground truncate text-[11px]">
                      {project.description || "Project"}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1" aria-label="Stage progress">
                      {STAGES.map((stage, i) => {
                        const state = project.stageStates.find((s) => s.stage === stage);
                        const status = state?.status ?? "NOT_STARTED";
                        return (
                          <div key={stage} className="flex items-center gap-1">
                            {i > 0 ? (
                              <span className="bg-border mx-0.5 h-px w-2.5" aria-hidden />
                            ) : null}
                            <span
                              title={`${stage}: ${status.replaceAll("_", " ").toLowerCase()}`}
                              className={cn(
                                "size-1.5 rounded-full",
                                STAGE_DOT[status] ?? STAGE_DOT.NOT_STARTED,
                              )}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Card>
              </Link>
              <ItemMenu
                open={menuFor === `p:${project.id}`}
                onOpenChange={(open) => setMenuFor(open ? `p:${project.id}` : null)}
                onMove={() => {
                  setMoveProject(project);
                  setMenuFor(null);
                }}
                onRefreshPreview={() => {
                  setMenuFor(null);
                  void renderPreview(project.id);
                }}
              />
            </div>
          ))}
        </div>
      )}

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>Create a folder in {currentName}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitFolder} className="flex flex-col gap-3">
            <Input
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Folder name"
              aria-label="Folder name"
            />
            {createFolder.error ? (
              <p className="text-destructive text-[12px]">{createFolder.error.message}</p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewFolderOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createFolder.isPending || !folderName.trim()}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Create a project in {currentName}.</DialogDescription>
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
            <Input
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder="Description (optional)"
              aria-label="Project description"
            />
            {createProject.error ? (
              <p className="text-destructive text-[12px]">{createProject.error.message}</p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewProjectOpen(false)}>
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
        onMove={(targetFolderId) => {
          if (moveProject) {
            moveProjectMut.mutate({ projectId: moveProject.id, folderId: targetFolderId });
          }
        }}
      />
    </div>
  );
}

function ItemMenu({
  open,
  onOpenChange,
  onRename,
  onMove,
  onDelete,
  color,
  onSetColor,
  onRefreshPreview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename?: () => void;
  onMove: () => void;
  onDelete?: () => void;
  /** Only folders are colorable; omitted for project rows. */
  color?: string | null;
  onSetColor?: (color: FolderColor | null) => void;
  /** Only projects have a 3D preview to re-render. */
  onRefreshPreview?: () => void;
}) {
  return (
    <div className="absolute top-2 right-2 z-10">
      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            "bg-background/80 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100",
            open && "opacity-100",
          )}
          aria-label="More actions"
          aria-expanded={open}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenChange(!open);
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
        {open ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-label="Close menu"
              onClick={() => onOpenChange(false)}
            />
            <div className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-1 min-w-[140px] rounded-lg border py-1 text-[13px] shadow-md">
              {onRename ? (
                <button
                  type="button"
                  className="hover:bg-muted w-full px-3 py-1.5 text-left"
                  onClick={onRename}
                >
                  Rename
                </button>
              ) : null}
              {onRefreshPreview ? (
                <button
                  type="button"
                  className="hover:bg-muted w-full px-3 py-1.5 text-left"
                  onClick={onRefreshPreview}
                >
                  Refresh preview
                </button>
              ) : null}
              <button
                type="button"
                className="hover:bg-muted w-full px-3 py-1.5 text-left"
                onClick={onMove}
              >
                Move to…
              </button>
              {onDelete ? (
                <button
                  type="button"
                  className="text-destructive hover:bg-muted w-full px-3 py-1.5 text-left"
                  onClick={onDelete}
                >
                  Delete
                </button>
              ) : null}
              {onSetColor ? (
                <FolderColorPicker
                  selected={color}
                  onSelect={(next) => {
                    onSetColor(next);
                    onOpenChange(false);
                  }}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
