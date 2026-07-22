"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderOpen,
  GitBranch,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      Loading editor…
    </div>
  ),
});

const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  ino: "cpp",
  rs: "rust",
  go: "go",
  json: "json",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  css: "css",
  html: "html",
  sh: "shell",
};

function languageFor(path: string): string {
  const ext = path.split(".").pop() ?? "";
  return LANGUAGES[ext] ?? "plaintext";
}

type TreeNode = {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  fileId?: string;
};

function buildTree(files: { id: string; path: string }[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const f of files) {
    const segments = f.path.split("/");
    let node = root;
    let acc = "";
    segments.forEach((seg, i) => {
      acc = acc ? `${acc}/${seg}` : seg;
      if (!node.children.has(seg)) {
        node.children.set(seg, { name: seg, path: acc, children: new Map() });
      }
      node = node.children.get(seg)!;
      if (i === segments.length - 1) node.fileId = f.id;
    });
  }
  return root;
}

function TreeView({
  node,
  depth,
  activeId,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  activeId: string | null;
  onOpen: (fileId: string, path: string) => void;
}) {
  const dirs = [...node.children.values()].filter((n) => !n.fileId || n.children.size > 0);
  const files = [...node.children.values()].filter((n) => n.fileId && n.children.size === 0);
  return (
    <>
      {[...dirs, ...files].map((child) =>
        child.fileId && child.children.size === 0 ? (
          <button
            key={child.path}
            type="button"
            onClick={() => onOpen(child.fileId!, child.path)}
            className={cn(
              "hover:bg-muted/60 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs",
              activeId === child.fileId && "bg-muted text-foreground",
            )}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
          >
            <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
            <span className="truncate">{child.name}</span>
          </button>
        ) : (
          <DirNode key={child.path} node={child} depth={depth} activeId={activeId} onOpen={onOpen} />
        ),
      )}
    </>
  );
}

function DirNode({
  node,
  depth,
  activeId,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  activeId: string | null;
  onOpen: (fileId: string, path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-muted/60 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {open ? (
          <ChevronDown className="text-muted-foreground size-3 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground size-3 shrink-0" />
        )}
        {open ? (
          <FolderOpen className="size-3.5 shrink-0 text-sky-400/80" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-sky-400/80" />
        )}
        <span className="truncate font-medium">{node.name}</span>
      </button>
      {open ? (
        <TreeView node={node} depth={depth + 1} activeId={activeId} onOpen={onOpen} />
      ) : null}
    </div>
  );
}

type OpenTab = { fileId: string; path: string };

export function CodeWorkspace({
  projectId,
  branchId,
  canEdit,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const reposQuery = trpc.engineer.listRepos.useQuery({ projectId, branchId });
  const repos = useMemo(() => reposQuery.data ?? [], [reposQuery.data]);

  const [repoId, setRepoId] = useState<string | null>(null);
  const activeRepo = repos.find((r) => r.id === repoId) ?? repos[0] ?? null;

  useEffect(() => {
    if (!repoId && repos.length > 0) setRepoId(repos[0]!.id);
  }, [repos, repoId]);

  const filesQuery = trpc.code.listFiles.useQuery(
    { repoId: activeRepo?.id ?? "" },
    { enabled: Boolean(activeRepo) },
  );
  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);

  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [newFilePath, setNewFilePath] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);

  const fileQuery = trpc.code.getFile.useQuery(
    { id: activeFileId ?? "" },
    { enabled: Boolean(activeFileId) },
  );

  const saveFile = trpc.code.saveFile.useMutation();
  const createFile = trpc.code.createFile.useMutation({
    onSuccess: (file) => {
      void utils.code.listFiles.invalidate({ repoId: file.repoId });
      openFile(file.id, file.path);
      setNewFilePath("");
      setShowNewFile(false);
    },
  });
  const deleteFile = trpc.code.deleteFile.useMutation({
    onSuccess: (res) => {
      if (activeRepo) void utils.code.listFiles.invalidate({ repoId: activeRepo.id });
      closeTab(res.id);
    },
  });
  const createRepo = trpc.engineer.createRepo.useMutation({
    onSuccess: () => utils.engineer.listRepos.invalidate({ projectId, branchId }),
  });

  const [content, setContent] = useState("");
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load file content when the active tab changes / server data arrives.
  useEffect(() => {
    if (fileQuery.data && fileQuery.data.id === activeFileId && !dirtyRef.current) {
      setContent(fileQuery.data.content);
    }
  }, [fileQuery.data, activeFileId]);

  function openFile(fileId: string, path: string) {
    dirtyRef.current = false;
    setTabs((t) => (t.some((tab) => tab.fileId === fileId) ? t : [...t, { fileId, path }]));
    setActiveFileId(fileId);
  }

  function closeTab(fileId: string) {
    setTabs((t) => {
      const next = t.filter((tab) => tab.fileId !== fileId);
      if (activeFileId === fileId) {
        dirtyRef.current = false;
        setActiveFileId(next[next.length - 1]?.fileId ?? null);
      }
      return next;
    });
  }

  function onChange(value: string | undefined) {
    if (!canEdit || activeFileId == null) return;
    const v = value ?? "";
    setContent(v);
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const fileId = activeFileId;
    saveTimer.current = setTimeout(() => {
      saveFile.mutate(
        { id: fileId, content: v },
        { onSuccess: () => (dirtyRef.current = false) },
      );
    }, 900);
  }

  function onCreateFile(e: FormEvent) {
    e.preventDefault();
    if (!activeRepo || !newFilePath.trim()) return;
    createFile.mutate({ repoId: activeRepo.id, path: newFilePath.trim() });
  }

  const [newRepoUrl, setNewRepoUrl] = useState("");
  const [newRepoRole, setNewRepoRole] = useState("firmware");

  if (repos.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="bg-muted flex size-12 items-center justify-center rounded-2xl">
          <GitBranch className="text-muted-foreground size-5" />
        </div>
        <div>
          <p className="font-medium">Link a repository to codebase</p>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            Connect a GitHub repository to open the code workspace — file tree, tabs, and an
            in-app editor. The copilot can write starter firmware for you.
          </p>
        </div>
        {canEdit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newRepoUrl.trim()) return;
              createRepo.mutate({
                projectId,
                branchId,
                role: newRepoRole.trim() || "firmware",
                url: newRepoUrl.trim(),
              });
            }}
            className="flex w-full max-w-md flex-col gap-2"
          >
            <div className="flex gap-2">
              <Input
                value={newRepoRole}
                onChange={(e) => setNewRepoRole(e.target.value)}
                className="w-32"
                aria-label="Repository role"
                placeholder="firmware"
              />
              <Input
                value={newRepoUrl}
                onChange={(e) => setNewRepoUrl(e.target.value)}
                type="url"
                placeholder="https://github.com/org/repo"
                aria-label="Repository URL"
                className="flex-1"
              />
            </div>
            <Button type="submit" disabled={createRepo.isPending}>
              <Plus className="size-4" /> Link repository
            </Button>
            {createRepo.error ? (
              <p className="text-destructive text-xs">{createRepo.error.message}</p>
            ) : null}
          </form>
        ) : null}
      </div>
    );
  }

  const tree = buildTree(files);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border">
      {/* Workspace navbar: repo switcher + actions */}
      <div className="bg-card/60 flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <GitBranch className="text-muted-foreground ml-1 size-3.5" />
        <select
          value={activeRepo?.id ?? ""}
          onChange={(e) => {
            setRepoId(e.target.value);
            setTabs([]);
            setActiveFileId(null);
          }}
          className="bg-transparent text-sm font-medium outline-none"
          aria-label="Repository"
        >
          {repos.map((r) => (
            <option key={r.id} value={r.id} className="bg-popover">
              {r.role} — {r.url.replace(/^https?:\/\/(www\.)?/, "")}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-muted-foreground mr-1 text-xs">
            {saveFile.isPending ? "Saving…" : dirtyRef.current ? "Unsaved" : "Synced"}
          </span>
          {activeRepo ? (
            <>
              <Button
                variant="outline"
                size="xs"
                render={
                  <a
                    href={`vscode://vscode.git/clone?url=${encodeURIComponent(activeRepo.url)}`}
                  />
                }
              >
                Open in VS Code
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Open repository on GitHub"
                render={<a href={activeRepo.url} target="_blank" rel="noreferrer" />}
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* File tree */}
        <div className="bg-card/30 flex w-56 shrink-0 flex-col border-r">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
              Files
            </span>
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setShowNewFile((s) => !s)}
                aria-label="New file"
              >
                <FilePlus className="size-3.5" />
              </Button>
            ) : null}
          </div>
          {showNewFile ? (
            <form onSubmit={onCreateFile} className="px-2 pb-2">
              <Input
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                placeholder="src/main.cpp"
                aria-label="New file path"
                autoFocus
                className="h-7 text-xs"
              />
              {createFile.error ? (
                <p className="text-destructive mt-1 text-[11px]">{createFile.error.message}</p>
              ) : null}
            </form>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {files.length === 0 ? (
              <p className="text-muted-foreground px-3 py-2 text-xs">
                No files yet. Create one or ask the copilot to scaffold the firmware.
              </p>
            ) : (
              <TreeView node={tree} depth={0} activeId={activeFileId} onOpen={openFile} />
            )}
          </div>
        </div>

        {/* Editor area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {tabs.length > 0 ? (
            <div className="bg-card/40 flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-1">
              {tabs.map((tab) => (
                <div
                  key={tab.fileId}
                  className={cn(
                    "group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs",
                    tab.fileId === activeFileId
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/50",
                  )}
                  onClick={() => {
                    dirtyRef.current = false;
                    setActiveFileId(tab.fileId);
                  }}
                >
                  <FileIcon className="size-3" />
                  {tab.path.split("/").pop()}
                  <button
                    type="button"
                    aria-label={`Close ${tab.path}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.fileId);
                    }}
                    className="hover:bg-muted-foreground/20 rounded p-0.5 opacity-0 group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {canEdit && activeFileId ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  aria-label="Delete file"
                  onClick={() => deleteFile.mutate({ id: activeFileId })}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1">
            {activeFileId && fileQuery.data ? (
              <MonacoEditor
                key={activeFileId}
                height="100%"
                theme="vs-dark"
                language={languageFor(fileQuery.data.path)}
                value={content}
                onChange={onChange}
                options={{
                  readOnly: !canEdit,
                  minimap: { enabled: false },
                  fontSize: 13,
                  scrollBeyondLastLine: false,
                  padding: { top: 12 },
                  automaticLayout: true,
                }}
              />
            ) : (
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                {files.length === 0
                  ? "Create a file to start coding."
                  : "Open a file from the tree."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
