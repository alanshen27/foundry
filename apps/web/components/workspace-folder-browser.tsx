"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Box,
  ChevronRight,
  Folder,
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
import { EmptyState } from "@/components/empty-state";
import { FolderColorPicker } from "@/components/folder-color-picker";
import { MatrixScreen } from "@/components/matrix-cover";
import { MoveToFolderDialog } from "@/components/move-to-folder-dialog";
import { ProjectCreateBar } from "@/components/project-create-bar";
import { ShareButton } from "@/components/share-button";
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

const TILE_FACE = "relative aspect-[16/10] overflow-hidden";
const TILE_CAPTION = "border-border flex flex-col gap-4 border-t p-4";

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

/** Keep real geometry legible; missing previews get a quiet, explicit placeholder. */
function PreviewFace({ project, className }: { project: BrowserProject; className?: string }) {
  const [broken, setBroken] = useState(false);
  // Skip stale thumbs (wrong format / outdated model) so the placeholder shows
  // until a fresh render lands — avoids caching Zoo error frames on cards.
  if (project.thumbnailUrl && !project.stale && !broken) {
    return (
      // Not next/image: these are authenticated proxy URLs, not optimizable assets.
      <img
        src={project.thumbnailUrl}
        alt=""
        className={cn("size-full object-cover", className)}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div
      className={cn(
        "bg-muted/35 text-muted-foreground relative flex size-full flex-col items-center justify-center gap-3",
        className,
      )}
    >
      <MatrixScreen color="currentColor" opacity={0.06} />
      <Box className="size-10 opacity-40" strokeWidth={1} aria-hidden />
      <span className="font-mono text-[10px] tracking-[0.08em] uppercase opacity-70">
        No preview yet
      </span>
    </div>
  );
}

function ProjectTileFace({ project, rendering }: { project: BrowserProject; rendering: boolean }) {
  return (
    <div className={cn(TILE_FACE, "bg-muted")}>
      <PreviewFace project={project} />
      {rendering ? (
        <div
          className="bg-background/70 absolute inset-0 z-[2] flex items-center justify-center backdrop-blur-sm"
          title="Rendering 3D preview"
        >
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        </div>
      ) : null}
    </div>
  );
}

function StageDots({ project }: { project: BrowserProject }) {
  return (
    <div
      role="img"
      className="flex items-center gap-1.5"
      aria-label={STAGES.map(
        (stage) =>
          `${stage}: ${(project.stageStates.find((state) => state.stage === stage)?.status ?? "NOT_STARTED").replaceAll("_", " ").toLowerCase()}`,
      ).join(", ")}
    >
      {STAGES.map((stage, i) => {
        const state = project.stageStates.find((s) => s.stage === stage);
        const status = state?.status ?? "NOT_STARTED";
        return (
          <div key={stage} className="flex items-center gap-1">
            {i > 0 ? <span className="bg-border h-px w-3" aria-hidden /> : null}
            <span
              title={`${stage}: ${status.replaceAll("_", " ").toLowerCase()}`}
              className={cn("size-1.5 rounded-full", STAGE_DOT[status] ?? STAGE_DOT.NOT_STARTED)}
            />
          </div>
        );
      })}
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
  const [blankFolderId, setBlankFolderId] = useState<string>(folderId ?? "");

  useEffect(() => {
    if (newProjectOpen) setBlankFolderId(folderId ?? "");
  }, [newProjectOpen, folderId]);

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
      router.push(`/w/${workspaceSlug}/projects/${project.slug}/engineer?view=assembly`);
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
    createFolder.mutate({
      workspaceId,
      name: folderName.trim(),
      parentId: folderId,
    });
  }

  function submitProject(e: FormEvent) {
    e.preventDefault();
    if (!projectName.trim()) return;
    createProject.mutate({
      workspaceId,
      name: projectName.trim(),
      description: projectDescription.trim() || undefined,
      folderId: blankFolderId || null,
    });
  }

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {crumbs.length > 0 ? (
            <nav
              aria-label="Breadcrumb"
              className="text-muted-foreground mb-2 flex flex-wrap items-center gap-1 font-mono text-[11px] tracking-[0.04em]"
            >
              <Link
                href={`/w/${workspaceSlug}`}
                className="hover:text-foreground transition-colors"
              >
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
          ) : null}
          {!folderId ? (
            <p className="text-muted-foreground mb-2 font-mono text-[10px] tracking-[0.14em] uppercase">
              Workspace
            </p>
          ) : null}
          <h1 className="break-words text-[30px] leading-tight font-medium tracking-[-0.04em]">
            {currentName}
          </h1>
          <p className="text-muted-foreground mt-2 text-[13px]">
            {foldersHere.length} folder{foldersHere.length === 1 ? "" : "s"}
            {" · "}
            {projectsHere.length} project{projectsHere.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setNewProjectOpen(true)}
          >
            <Plus className="size-3.5" />
            Blank project
          </Button>
          {!folderId ? (
            <ShareButton
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              variant="invite"
              appearance="outline"
            />
          ) : null}
        </div>
      </div>

      <ProjectCreateBar
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        folders={folders}
        defaultFolderId={folderId}
      />

      {empty ? (
        <EmptyState
          title={folderId ? "This folder is empty" : "Your first project starts here"}
          className="min-h-56"
        >
          <p>
            {folderId
              ? "Create a project here, or move one into this folder."
              : "Describe a product above, or start with a blank project."}
          </p>
          <div className="text-foreground mt-3 flex justify-center gap-2">
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
              Blank project
            </Button>
          </div>
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {foldersHere.length > 0 ? (
            <section aria-labelledby="workspace-folders-heading">
              <div className="mb-3 flex items-center gap-2.5">
                <h2 id="workspace-folders-heading" className="text-[13px] font-medium">
                  Folders
                </h2>
                <span className="text-muted-foreground font-mono text-[11px]">
                  {foldersHere.length}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
                {foldersHere.map((folder) => (
                  <div key={folder.id} className="group relative">
                    <Link href={`/w/${workspaceSlug}/folders/${folder.id}`} className="block">
                      <Card className="flex-row items-center gap-3 p-4 pr-12 transition-colors hover:bg-muted/40 hover:ring-foreground/25">
                        <div
                          className={cn(
                            "flex size-10 shrink-0 items-center justify-center",
                            folderColorStyle(folder.color, folder.id).tile,
                          )}
                        >
                          <Folder className="size-5" strokeWidth={1.5} aria-hidden />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium" title={folder.name}>
                            {folder.name}
                          </p>
                          <p className="text-muted-foreground mt-1 truncate text-[12px]">
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
              </div>
            </section>
          ) : null}

          {projectsHere.length > 0 ? (
            <section aria-labelledby="workspace-projects-heading">
              <div className="border-border mb-4 flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2.5">
                  <h2 id="workspace-projects-heading" className="text-[13px] font-medium">
                    Projects
                  </h2>
                  <span className="text-muted-foreground font-mono text-[11px]">
                    {projectsHere.length}
                  </span>
                </div>
                <span className="text-muted-foreground font-mono text-[10px] tracking-[0.06em] uppercase">
                  A–Z
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4">
                {projectsHere.map((project) => (
                  <div key={project.id} className="group relative">
                    <Link
                      href={`/w/${workspaceSlug}/projects/${project.slug}/engineer?view=assembly`}
                      className="block"
                    >
                      <Card className="gap-0 py-0 transition-colors hover:ring-foreground/30">
                        <ProjectTileFace
                          project={project}
                          rendering={renderingIds.has(project.id)}
                        />
                        <div className={TILE_CAPTION}>
                          <div className="min-w-0">
                            <p
                              className="line-clamp-2 min-h-10 text-[14px] leading-5 font-medium tracking-[-0.015em]"
                              title={project.name}
                            >
                              {project.name}
                            </p>
                            <p className="text-muted-foreground mt-1.5 truncate text-[12px]">
                              {project.description || "No description yet"}
                            </p>
                          </div>
                          <div className="flex items-center justify-between">
                            <StageDots project={project} />
                            <ArrowUpRight
                              className="text-muted-foreground size-3.5 transition-colors group-hover:text-primary"
                              aria-hidden
                            />
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
            </section>
          ) : null}
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
            <DialogTitle>Blank project</DialogTitle>
            <DialogDescription>
              Create an empty project in {currentName} without kicking off the AI pipeline.
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
            <Input
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder="Description (optional)"
              aria-label="Project description"
            />
            <div>
              <label
                htmlFor="blank-project-folder"
                className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase"
              >
                Folder
              </label>
              <select
                id="blank-project-folder"
                className="border-input bg-background mt-1.5 h-9 w-full border px-3 text-sm outline-none"
                value={blankFolderId}
                onChange={(e) => setBlankFolderId(e.target.value)}
              >
                <option value="">Workspace root</option>
                {folders
                  .map((f) => ({
                    id: f.id,
                    label: folderBreadcrumbs(folders, f.id)
                      .map((c) => c.name)
                      .join(" / "),
                  }))
                  .sort((a, b) => a.label.localeCompare(b.label))
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
              </select>
            </div>
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
                renameMut.mutate({
                  folderId: renameFolder.id,
                  name: renameValue.trim(),
                });
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
            moveProjectMut.mutate({
              projectId: moveProject.id,
              folderId: targetFolderId,
            });
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
            "bg-card text-muted-foreground opacity-100 ring-1 ring-border transition-colors hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100",
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
            <div className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-1 min-w-[140px] rounded-none border py-1 text-[13px] shadow-md">
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
