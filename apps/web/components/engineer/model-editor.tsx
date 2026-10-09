"use client";

import { useCollaborativeDesign } from "./use-collaborative-design";
import { DesignCollaborationStatus } from "./design-collaboration-status";

/**
 * Mechanical CAD workspace: multi-component tree (parts / assembly /
 * instructions), collaborative Python sources, and a local Three.js viewport.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import dynamic from "next/dynamic";
import {
  Bot,
  Boxes,
  ChevronDown,
  ChevronRight,
  Code,
  Download,
  FilePlus,
  FileText,
  GripVertical,
  Layers,
  Lock,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  Redo2,
  Ruler,
  Undo2,
  Upload,
} from "lucide-react";
import { cadCursorSurface, normalizedCursorCoordinate, type CursorState } from "@foundry/realtime";
import { Button } from "@/components/ui/button";
import { DotMatrixLoader } from "@/components/dot-matrix-loader";
import {
  addCadAsset,
  addCadComponent,
  assemblyDropTargetId,
  cadAssetImportMode,
  displayNameFromCadPath,
  getActiveComponent,
  isCadStarterComponent,
  isPythonCadComponent,
  selectCadComponentId,
  importMeshAsPart,
  insertPartIntoAssembly,
  normalizeCadDoc,
  setActiveComponent,
  slugifyCadName,
  upsertPartScript,
  upsertPythonPart,
  updateComponentContent,
  type CadComponent,
  type CadComponentKind,
  type CadDoc,
} from "@/lib/cad/engine";
import { cadViewportInput } from "@/lib/cad/viewport-project";
import { CadViewport } from "@/components/engineer/cad-viewport";
import { CadImportDialog, type CadImportUnit } from "@/components/engineer/cad-import-dialog";
import { LEGACY_CAD_PREVIEW_MESSAGE, safeCadError } from "@/lib/cad/safe-error";
import { useWorkspaceUiPreview } from "@/components/dev/workspace-ui-preview";
import { useTheme } from "@/components/theme-provider";
import { defineFoundryMonacoThemes } from "@/lib/monaco-theme";
import { monacoThemeFor } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useCursors } from "@/lib/use-cursors";
import { useLiveEdit } from "@/lib/use-live-edit";
import { ViewportComments, type CommentPoint } from "@/components/engineer/viewport-comments";

// The viewport opens first; download Monaco only when the source panel is opened.
const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const KIND_META: Record<CadComponentKind, { label: string; icon: typeof Puzzle }> = {
  part: { label: "Manufacturing", icon: Puzzle },
  assembly: { label: "Assembly", icon: Boxes },
  instructions: { label: "Instructions", icon: FileText },
};

function ComponentTree({
  doc,
  activeId,
  canEdit,
  onSelect,
  onAdd,
  onImport,
  onInsertPart,
}: {
  doc: CadDoc;
  activeId: string;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onAdd: (kind: CadComponentKind) => void;
  onImport: () => void;
  onInsertPart: (assemblyId: string, partId: string) => void;
}) {
  const groups: CadComponentKind[] = ["part", "assembly", "instructions"];
  const [openGroups, setOpenGroups] = useState<Record<CadComponentKind, boolean>>({
    part: true,
    assembly: true,
    instructions: false,
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
      <div className="mx-2 mb-3 border-b pb-2">
        <button
          type="button"
          onClick={onImport}
          disabled={!canEdit}
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-8 w-full items-center gap-2 rounded-none px-2 text-left font-mono text-[10px] tracking-[0.08em] uppercase disabled:opacity-40"
        >
          <Upload className="size-3.5" />
          <span className="font-medium">Import design file</span>
        </button>
      </div>
      {groups.map((kind) => {
        const meta = KIND_META[kind];
        const Icon = meta.icon;
        const items = doc.components.filter((c) => c.kind === kind);
        const open = openGroups[kind];
        return (
          <div key={kind} className="mb-2">
            <div className="text-muted-foreground flex items-center px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenGroups((current) => ({ ...current, [kind]: !open }))}
                className="hover:bg-muted flex min-w-0 flex-1 items-center gap-1.5 rounded-none px-1 py-1 text-left"
              >
                {open ? (
                  <ChevronDown className="size-3 shrink-0" />
                ) : (
                  <ChevronRight className="size-3 shrink-0" />
                )}
                <Icon className="size-3 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate font-medium">{meta.label}</span>
                <span className="font-mono text-[9px] opacity-70">{items.length}</span>
              </button>
              {canEdit ? (
                <button
                  type="button"
                  title={`Add ${kind}`}
                  onClick={() => onAdd(kind)}
                  className="hover:bg-muted ml-1 rounded-none p-1"
                >
                  <FilePlus className="size-3" />
                </button>
              ) : null}
            </div>
            {open ? (
              <>
                {items.map((c) => {
                  // Show the logical part name; the full source path stays in the tooltip.
                  const label = c.name || displayNameFromCadPath(c.path);
                  const ext = c.path.match(/\.[^.\/]+$/)?.[0] ?? "";
                  const canDropPart = kind === "assembly" && canEdit;
                  const imported = Boolean(
                    kind === "part" &&
                    doc.assets?.some(
                      (asset) =>
                        c.content.includes(asset.path) ||
                        c.name === asset.name ||
                        c.name === slugifyCadName(asset.name),
                    ),
                  );
                  return (
                    <button
                      key={c.id}
                      type="button"
                      draggable={kind === "part" && canEdit}
                      title={
                        kind === "part" && canEdit
                          ? `${c.path} — drag onto the CAD canvas to place`
                          : c.path
                      }
                      onDragStart={(event) => {
                        if (kind !== "part") return;
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData("application/x-foundry-cad-part", c.id);
                        event.dataTransfer.setData("text/plain", c.id);
                      }}
                      onDragOver={(event) => {
                        if (!canDropPart) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(event) => {
                        if (!canDropPart) return;
                        event.preventDefault();
                        const partId =
                          event.dataTransfer.getData("application/x-foundry-cad-part") ||
                          event.dataTransfer.getData("text/plain");
                        if (partId) onInsertPart(c.id, partId);
                      }}
                      onClick={() => onSelect(c.id)}
                      className={cn(
                        "group hover:bg-muted/60 flex w-full items-center gap-2 border-l-2 border-l-transparent py-1.5 pr-2.5 pl-4 text-left text-xs",
                        activeId === c.id &&
                          "border-l-primary bg-primary/8 text-foreground font-medium",
                        canDropPart && "border-y border-y-transparent hover:border-y-primary/30",
                        kind === "part" && canEdit && "cursor-grab active:cursor-grabbing",
                      )}
                    >
                      <Layers
                        className={cn(
                          "size-3 shrink-0",
                          activeId === c.id ? "text-primary" : "text-muted-foreground/60",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono">
                        {label}
                        {ext}
                      </span>
                      {imported ? (
                        <span className="bg-muted text-muted-foreground rounded-none border px-1 py-0.5 font-mono text-[8px] tracking-[0.06em] uppercase">
                          imported
                        </span>
                      ) : null}
                      {kind === "part" && canEdit ? (
                        <GripVertical
                          className="text-muted-foreground size-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                          aria-label="Drag part to canvas"
                        />
                      ) : null}
                    </button>
                  );
                })}
                {items.length === 0 ? (
                  <p className="text-muted-foreground px-2.5 py-1 text-[11px]">None yet</p>
                ) : null}
                {kind === "assembly" && items.length > 0 ? (
                  <p className="text-muted-foreground px-2.5 py-1 text-[9px]">
                    Drop a part here or anywhere on the canvas.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function InstructionsPreview({ content }: { content: string }) {
  return (
    <div className="absolute inset-0 overflow-y-auto p-8">
      <article className="prose prose-sm dark:prose-invert mx-auto max-w-2xl whitespace-pre-wrap font-sans text-sm leading-relaxed">
        {content}
      </article>
    </div>
  );
}

function CadCursorLayer({ peers }: { peers: CursorState[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden" aria-hidden="true">
      {peers.map((peer) => (
        <div
          key={peer.userId}
          className="absolute will-change-transform"
          style={{
            left: `${normalizedCursorCoordinate(peer.x) * 100}%`,
            top: `${normalizedCursorCoordinate(peer.y) * 100}%`,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 18 18" className="block drop-shadow">
            <path
              d="M2 2 L2 14 L5.5 10.8 L7.8 15.6 L10.2 14.5 L7.9 9.8 L12.4 9.6 Z"
              fill={peer.color}
              stroke="#0b0b0b"
              strokeWidth={1}
              strokeLinejoin="round"
            />
          </svg>
          <span
            className="absolute top-4 left-3 rounded-none px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-[#0b0b0b] shadow"
            style={{ background: peer.color }}
          >
            {peer.name}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Owns cursor state so peer updates do not re-render CadViewport / Monaco.
 * Parent only holds a ref to `report`.
 */
function CadCursorOverlay({
  projectId,
  branchId,
  surface,
  self,
  reportRef,
}: {
  projectId: string;
  branchId: string;
  surface: string;
  self: { userId: string; name: string };
  reportRef: MutableRefObject<((x: number, y: number) => void) | null>;
}) {
  const cursors = useCursors(projectId, branchId, surface, self);
  useEffect(() => {
    reportRef.current = cursors.report;
    return () => {
      reportRef.current = null;
    };
  }, [cursors.report, reportRef]);
  return <CadCursorLayer peers={cursors.peers} />;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function ModelEditor({
  projectId,
  branchId,
  canEdit,
  focusComponentId,
  onOpenComponent,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
  /** When set (e.g. opened from Assembly / a model tab), select that CadDoc component. */
  focusComponentId?: string;
  /**
   * Tree click → open a document tab (Chrome-style) instead of only swapping
   * the in-editor selection. Parent keeps one ModelEditor mounted so parsed
   * viewport scenes are reused across part tabs.
   */
  onOpenComponent?: (component: { id: string; name: string }) => void;
}) {
  const { theme } = useTheme();
  const localPreview = useWorkspaceUiPreview();
  const monacoTheme = monacoThemeFor(theme.mode);
  const query = trpc.design.get.useQuery(
    { projectId, branchId, kind: "MODEL3D" },
    {
      // Collab + save mutations invalidate; avoid hammering Auth/DB every 1.5s.
      staleTime: 5_000,
      refetchOnWindowFocus: true,
    },
  );
  const aiLock = trpc.design.aiEditLock.useQuery(
    { projectId, branchId },
    {
      // Poll only while an AI edit holds the lock; otherwise rely on invalidate.
      refetchInterval: (q) => (q.state.data ? 2_000 : false),
      refetchOnWindowFocus: true,
    },
  );
  const viewer = trpc.project.viewer.useQuery();
  const save = trpc.design.save.useMutation();
  const importMesh = trpc.cad.importMesh.useMutation();

  const [doc, setDoc] = useState<CadDoc | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(true);
  const [showCode, setShowCode] = useState(false);
  const [partDragActive, setPartDragActive] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"step" | "stl" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [commentMode, setCommentMode] = useState(false);
  /** Where a new comment is being composed, in normalized viewport coords. */
  const [pendingComment, setPendingComment] = useState<CommentPoint | null>(null);
  const [syncingAfterLock, setSyncingAfterLock] = useState(false);
  const [, setHistoryVersion] = useState(0);
  const dirtyRef = useRef(false);
  const migratedRef = useRef(false);
  const sawLockRef = useRef(false);
  const appliedUpdatedAtRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<{
    past: CadDoc[];
    future: CadDoc[];
    lastRecordedAt: number;
    lastComponentId: string | null;
  }>({ past: [], future: [], lastRecordedAt: 0, lastComponentId: null });
  const saveRef = useRef(save);
  saveRef.current = save;
  const locked = Boolean(aiLock.data);
  const sharedBaseRef = useRef<unknown>(null);
  const shared = useCollaborativeDesign({
    projectId,
    branchId,
    kind: "MODEL3D",
    canEdit: canEdit && !locked,
    onRemoteData: (data) => {
      if (dirtyRef.current) return;
      const next = normalizeCadDoc(data);
      sharedBaseRef.current = next;
      setDoc(next);
      setActiveId((current) => selectCadComponentId(next, current, focusComponentId));
    },
  });

  // Human soft locks per component: while a collaborator edits a part's source,
  // that part is read-only for everyone else (the AI lock stays doc-wide).
  const live = useLiveEdit(
    projectId,
    branchId,
    "cad",
    {
      userId: viewer.data?.id ?? "anonymous",
      name: viewer.data?.name ?? "Someone",
    },
    () => {
      if (!dirtyRef.current) void query.refetch();
    },
  );
  const liveRef = useRef(live);
  liveRef.current = live;
  const peerLock = activeId ? live.lockHolder(activeId) : undefined;
  const editable =
    canEdit &&
    shared.canEdit &&
    (shared.mode === "local" || shared.ready) &&
    !locked &&
    !syncingAfterLock &&
    !peerLock;

  const measurement = trpc.cad.measure.useQuery(
    { projectId, branchId, componentId: activeId ?? "" },
    { enabled: false, retry: false },
  );

  useEffect(() => {
    if ((shared.mode !== "local" && !shared.awaitingLive) || !query.isFetched) return;
    if (shared.awaitingLive && !query.data) return;
    const serverUpdatedAt = query.data?.updatedAt
      ? new Date(query.data.updatedAt).toISOString()
      : "empty";
    // Always take newer server docs (copilot writes) even if local was dirty —
    // otherwise AI-added parts never appear after a parallel race or autosave.
    const serverIsNew = appliedUpdatedAtRef.current !== serverUpdatedAt;
    // A project without a persisted MODEL3D row reports the same "empty"
    // snapshot on every poll. Re-normalizing it would mint fresh component ids
    // every 1.5s and remount Monaco / reset CAD selection.
    if (!serverIsNew) return;

    const next = normalizeCadDoc(query.data?.data ?? null);
    sharedBaseRef.current = next;
    appliedUpdatedAtRef.current = serverUpdatedAt;
    dirtyRef.current = false;
    setDoc(next);
    setActiveId((prev) => selectCadComponentId(next, prev, focusComponentId));

    const raw = query.data?.data as { version?: unknown } | null | undefined;
    if (editable && !migratedRef.current && raw && typeof raw === "object" && raw.version !== 5) {
      migratedRef.current = true;
      saveRef.current.mutate({
        projectId,
        branchId,
        kind: "MODEL3D",
        data: next,
      });
    }
  }, [
    query.data,
    query.isFetched,
    editable,
    projectId,
    branchId,
    focusComponentId,
    shared.mode,
    shared.awaitingLive,
  ]);

  useEffect(() => {
    if (!doc || !focusComponentId) return;
    if (doc.components.some((c) => c.id === focusComponentId)) {
      setActiveId(focusComponentId);
    }
  }, [focusComponentId, doc]);

  useEffect(() => {
    if (locked) {
      sawLockRef.current = true;
      setSyncingAfterLock(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      dirtyRef.current = false;
      historyRef.current = {
        past: [],
        future: [],
        lastRecordedAt: 0,
        lastComponentId: null,
      };
      setHistoryVersion((version) => version + 1);
      return;
    }
    if (!sawLockRef.current) return;
    void query.refetch().finally(() => {
      sawLockRef.current = false;
      setSyncingAfterLock(false);
    });
  }, [locked, query.refetch]);

  function persist(
    next: CadDoc,
    options: {
      recordHistory?: boolean;
      checkpoint?: boolean;
      activeIdOverride?: string;
    } = {},
  ) {
    const nextActiveId =
      options.activeIdOverride ??
      (activeId && next.components.some((component) => component.id === activeId)
        ? activeId
        : next.activeId);
    const normalizedNext = setActiveComponent(next, nextActiveId);

    if (doc && options.recordHistory !== false) {
      const history = historyRef.current;
      const now = Date.now();
      const shouldCheckpoint =
        options.checkpoint ||
        history.lastComponentId !== nextActiveId ||
        now - history.lastRecordedAt > 800;
      if (shouldCheckpoint) {
        history.past = [...history.past.slice(-49), doc];
      }
      history.future = [];
      history.lastRecordedAt = now;
      history.lastComponentId = nextActiveId;
      setHistoryVersion((version) => version + 1);
    }

    if (shared.mode !== "local") {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      try {
        dirtyRef.current = false;
        shared.applySnapshot(sharedBaseRef.current ?? doc, normalizedNext);
        setExecError(null);
      } catch (error) {
        setExecError(error instanceof Error ? error.message : "Could not synchronize CAD edits");
      }
      return;
    }
    setDoc(normalizedNext);
    dirtyRef.current = true;
    liveRef.current.acquire(nextActiveId);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveRef.current.mutate(
        {
          projectId,
          branchId,
          kind: "MODEL3D",
          baseData: sharedBaseRef.current,
          data: normalizedNext,
        },
        {
          onSuccess: (saved) => {
            dirtyRef.current = false;
            sharedBaseRef.current = saved.data;
            if (saved.updatedAt) {
              appliedUpdatedAtRef.current = new Date(saved.updatedAt).toISOString();
            }
            liveRef.current.release(nextActiveId);
            liveRef.current.commit();
          },
        },
      );
    }, 900);
  }

  function onSelect(id: string) {
    const c = doc?.components.find((x) => x.id === id);
    if (onOpenComponent && c) {
      onOpenComponent({ id: c.id, name: c.name });
      return;
    }
    setActiveId(id);
  }

  function onAdd(kind: CadComponentKind) {
    if (!doc || !editable) return;
    const base = kind === "part" ? "part" : kind === "assembly" ? "assembly" : "instructions";
    const n = doc.components.filter((c) => c.kind === kind).length + 1;
    const next = addCadComponent({ ...doc, engine: "build123d" }, { name: `${base}-${n}`, kind });
    setActiveId(next.activeId);
    persist(next, { checkpoint: true, activeIdOverride: next.activeId });
  }

  function onInsertPart(assemblyId: string, partId: string) {
    if (!doc || !editable) return;
    const assembly = doc.components.find((component) => component.id === assemblyId);
    if (assembly && !isPythonCadComponent(assembly)) {
      setExportError(
        "Create or open a Python assembly before placing parts. The legacy assembly is preserved.",
      );
      return;
    }
    try {
      const next = insertPartIntoAssembly(doc, assemblyId, partId);
      if (next === doc) return;
      setActiveId(assemblyId);
      persist(next, { checkpoint: true, activeIdOverride: assemblyId });
    } catch {
      setExportError(
        "This part cannot be placed yet. Generate or convert its source to Python first.",
      );
    }
  }

  function onChangeContent(next: string | undefined, checkpoint = false) {
    if (!editable || !doc || !activeId || next === undefined) return;
    const current = doc.components.find((c) => c.id === activeId);
    if (!current) return;
    if ((current.kind === "part" || current.kind === "assembly") && !next.trim()) return;
    persist(updateComponentContent(doc, activeId, next), { checkpoint });
  }

  function undo() {
    if (!editable || !doc) return;
    const history = historyRef.current;
    const previous = history.past.at(-1);
    if (!previous) return;
    history.past = history.past.slice(0, -1);
    history.future = [...history.future, doc].slice(-50);
    history.lastRecordedAt = 0;
    history.lastComponentId = null;
    setHistoryVersion((version) => version + 1);
    setActiveId(previous.activeId);
    persist(previous, {
      recordHistory: false,
      checkpoint: true,
      activeIdOverride: previous.activeId,
    });
  }

  function redo() {
    if (!editable || !doc) return;
    const history = historyRef.current;
    const next = history.future.at(-1);
    if (!next) return;
    history.future = history.future.slice(0, -1);
    history.past = [...history.past, doc].slice(-50);
    history.lastRecordedAt = 0;
    history.lastComponentId = null;
    setHistoryVersion((version) => version + 1);
    setActiveId(next.activeId);
    persist(next, {
      recordHistory: false,
      checkpoint: true,
      activeIdOverride: next.activeId,
    });
  }

  async function confirmImport(file: File, unit: CadImportUnit) {
    if (!doc || !editable) return;
    setImportError(null);
    if (file.size > 25_000_000) {
      setImportError("File exceeds the 25 MB design import limit.");
      return;
    }
    try {
      const contentBase64 = await fileToBase64(file);
      const result = await importMesh.mutateAsync({
        projectId,
        branchId,
        filename: file.name,
        contentBase64,
        lengthUnit: unit,
      });
      const mode = cadAssetImportMode(result.asset.format);
      let next: CadDoc;
      if (mode === "native-python") {
        const source = (await file.text()).trim();
        if (!source) throw new Error("The selected Python file is empty.");
        next = upsertPythonPart(addCadAsset(doc, result.asset), result.asset.name, source);
      } else if (mode === "native-kcl") {
        const source = (await file.text()).trim();
        if (!source) throw new Error("The selected KCL file is empty.");
        const withAsset = addCadAsset(doc, result.asset);
        next = {
          ...upsertPartScript({ ...withAsset, engine: "zoo" }, result.asset.name, source),
          engine: doc.engine,
        };
      } else {
        next = importMeshAsPart({ ...doc, engine: "build123d" }, result.asset);
      }
      setActiveId(next.activeId);
      persist(next, { checkpoint: true, activeIdOverride: next.activeId });
      setImportOpen(false);
    } catch (error) {
      setImportError(safeCadError(error, "import"));
    }
  }

  const viewDoc: CadDoc | null = useMemo(
    () => (doc && activeId ? setActiveComponent(doc, activeId) : doc),
    [doc, activeId],
  );
  const active: CadComponent | null = viewDoc ? getActiveComponent(viewDoc) : null;
  const isCadSource = active?.kind === "part" || active?.kind === "assembly";
  const isPython = active ? isPythonCadComponent(active) : false;
  const isKcl = Boolean(isCadSource && !isPython);
  const isStarter = active ? isCadStarterComponent(active) : false;
  const reportCursorRef = useRef<((x: number, y: number) => void) | null>(null);
  const cursorSelf = {
    userId: viewer.data?.id ?? "anonymous",
    name: viewer.data?.name ?? "Someone",
  };

  // Debounce the whole document rather than just the active script: an assembly
  // renders from every part it imports, so the engine needs one consistent
  // snapshot instead of a single file that may be newer than its siblings.
  const [settled, setSettled] = useState<{ doc: CadDoc; activeId: string } | null>(null);
  const settledComponentId = useRef<string | null>(null);
  useEffect(() => {
    if (!viewDoc || !active || !isCadSource) {
      setSettled(null);
      settledComponentId.current = null;
      return;
    }
    const delay =
      settledComponentId.current !== active.id
        ? 0
        : active.content.length > 12_000
          ? 1_400
          : active.content.length > 4_000
            ? 900
            : 500;
    const timer = setTimeout(() => {
      settledComponentId.current = active.id;
      setSettled({ doc: viewDoc, activeId: active.id });
    }, delay);
    return () => clearTimeout(timer);
  }, [viewDoc, active?.id, active?.content, isCadSource]);

  const viewportResult = useMemo(() => {
    try {
      // A different part is a complete saved snapshot, so select it immediately.
      // Only edits within that same part need the typing debounce.
      const snapshot =
        active && viewDoc && settled?.activeId !== active.id
          ? { doc: viewDoc, activeId: active.id }
          : settled;
      return {
        data: snapshot ? cadViewportInput(snapshot.doc, snapshot.activeId) : null,
        error: null,
      };
    } catch {
      return {
        data: null,
        error:
          "A referenced CAD file is missing or unavailable. Restore the import or update the source part.",
      };
    }
  }, [settled, active?.id, viewDoc]);
  const viewport = viewportResult.data;
  const needsConversion = isKcl && !viewport?.foreignImportOnly;

  useEffect(() => {
    setExportError(null);
    setExecError(null);
  }, [active?.id]);

  async function exportCad(format: "step" | "stl") {
    if (!viewDoc || !active || !isPython || localPreview || exporting) return;
    setExporting(format);
    setExportError(null);
    try {
      // Export the current collaborative source, including edits still waiting
      // for the preview debounce or database checkpoint.
      const input = cadViewportInput(viewDoc, active.id);
      if (!input) throw new Error("No CAD source to export");
      const response = await fetch(`/api/cad/export?format=${format}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, projectId }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(typeof detail?.error === "string" ? detail.error : "CAD export failed");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slugifyCadName(active.name) || "model"}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setExportError(safeCadError(error));
    } finally {
      setExporting(null);
    }
  }

  const canvasAssemblyId = doc
    ? assemblyDropTargetId(doc, active?.id ?? activeId ?? undefined)
    : null;
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  if (doc === null) {
    return (
      <>
        <DotMatrixLoader className="absolute inset-0" label="Loading CAD" />
        <DesignCollaborationStatus status={shared.status} error={shared.error} />
      </>
    );
  }

  return (
    <div data-cad-workspace className="absolute inset-0 flex">
      <DesignCollaborationStatus status={shared.status} error={shared.error} />
      {showTree ? (
        <div className="bg-card flex w-52 shrink-0 flex-col border-r">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
            <Boxes className="text-primary size-3.5" />
            <span className="font-mono text-[11px] font-medium tracking-[0.08em] uppercase">
              Design browser
            </span>
            <span className="text-muted-foreground ml-auto font-mono text-[9px] tracking-[0.08em] uppercase">
              {isPython ? "PYTHON" : isKcl ? "LEGACY KCL" : "SOURCE"}
            </span>
          </div>
          <ComponentTree
            doc={doc}
            activeId={activeId ?? doc.activeId}
            canEdit={editable}
            onSelect={onSelect}
            onAdd={onAdd}
            onImport={() => {
              setImportError(null);
              setImportOpen(true);
            }}
            onInsertPart={onInsertPart}
          />
        </div>
      ) : null}

      {showCode ? (
        <div className="flex min-w-0 w-[min(42%,420px)] shrink-0 flex-col border-r">
          <div className="bg-card flex h-10 shrink-0 items-center gap-2 border-b px-3">
            <span className="truncate font-mono text-xs font-medium" title={active?.path}>
              {active
                ? `${active.name || displayNameFromCadPath(active.path)}${
                    active.path.match(/\.[^.\/]+$/)?.[0] ?? ""
                  }`
                : "—"}
            </span>
            <span className="text-muted-foreground ml-auto font-mono text-[10px] tracking-[0.08em] uppercase">
              {save.isPending ? "Saving…" : "Autosaves"}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <Editor
              key={`${monacoTheme}-${active?.id ?? "none"}`}
              language={isPython ? "python" : isKcl ? "plaintext" : "markdown"}
              theme={monacoTheme}
              beforeMount={defineFoundryMonacoThemes}
              value={active?.content ?? ""}
              onChange={(value) => onChangeContent(value)}
              options={{
                readOnly: !editable,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                padding: { top: 10 },
              }}
            />
          </div>
          {execError && isCadSource ? (
            <div className="text-destructive shrink-0 border-t px-3 py-2 font-mono text-[11px] leading-relaxed">
              {execError}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className="bg-background relative min-w-0 flex-1"
        onDragEnter={(event) => {
          if (!editable || !canvasAssemblyId) return;
          if (Array.from(event.dataTransfer.types).includes("application/x-foundry-cad-part")) {
            setPartDragActive(true);
          }
        }}
        onDragOver={(event) => {
          if (!editable || !canvasAssemblyId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          setPartDragActive(false);
        }}
        onDrop={(event) => {
          setPartDragActive(false);
          if (!editable || !canvasAssemblyId) return;
          event.preventDefault();
          const partId =
            event.dataTransfer.getData("application/x-foundry-cad-part") ||
            event.dataTransfer.getData("text/plain");
          if (partId) onInsertPart(canvasAssemblyId, partId);
        }}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          reportCursorRef.current?.(
            normalizedCursorCoordinate((event.clientX - rect.left) / rect.width),
            normalizedCursorCoordinate((event.clientY - rect.top) / rect.height),
          );
        }}
        onClickCapture={(event) => {
          if (!commentMode || pendingComment) return;
          // Comment mode pins on the scene, not on toolbar/panel controls.
          const target = event.target as HTMLElement;
          if (target.closest("button, input, textarea, select, a")) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          event.preventDefault();
          event.stopPropagation();
          setPendingComment({
            x: normalizedCursorCoordinate((event.clientX - rect.left) / rect.width),
            y: normalizedCursorCoordinate((event.clientY - rect.top) / rect.height),
          });
        }}
      >
        {active?.kind === "instructions" ? (
          <InstructionsPreview content={active.content} />
        ) : (
          <>
            {viewportResult.error ? (
              <div
                role="alert"
                className="text-destructive bg-background/95 absolute inset-x-0 top-0 z-20 border-b p-3 text-xs"
              >
                {viewportResult.error}
              </div>
            ) : null}
            {needsConversion ? (
              <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
                <div className="max-w-xs">
                  <Code className="text-muted-foreground mx-auto size-6" strokeWidth={1.5} />
                  <p className="mt-3 font-mono text-sm font-medium tracking-[-0.02em]">
                    Convert this part to Python
                  </p>
                  <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                    {LEGACY_CAD_PREVIEW_MESSAGE}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => setShowCode(true)}
                  >
                    Open preserved source
                  </Button>
                </div>
              </div>
            ) : isStarter ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 pt-20 pb-28 text-center">
                <div className="max-w-xs">
                  <p className="font-mono text-sm font-medium tracking-[-0.02em]">
                    No geometry yet
                  </p>
                  <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                    Open Python source or ask Copilot to build your part with build123d.
                  </p>
                </div>
              </div>
            ) : viewport ? (
              <CadViewport
                engine={viewport.engine}
                script={viewport.script}
                modelKey={active?.id}
                debounceMs={0}
                projectId={projectId}
                view="orbit"
                chrome={true}
                projectFiles={viewport.projectFiles}
                entryPath={viewport.entryPath}
                meshAssets={viewport.meshAssets}
                foreignImportOnly={viewport.foreignImportOnly}
                onError={setExecError}
              />
            ) : null}
            {isPython && (measurement.data || measurement.error || exportError) ? (
              <div className="bg-card/95 text-muted-foreground absolute top-3 right-3 z-20 max-w-xs rounded-none border px-3 py-2 text-[10px] leading-relaxed">
                {measurement.data ? (
                  <p className="font-mono">
                    Saved model:{" "}
                    {(["x", "y", "z"] as const)
                      .map((axis) => measurement.data.dimensions[axis].toFixed(2))
                      .join(" × ")}{" "}
                    mm
                  </p>
                ) : null}
                {measurement.error ? (
                  <p role="alert" className="text-destructive">
                    {safeCadError(measurement.error)}
                  </p>
                ) : null}
                {exportError ? (
                  <p role="alert" className="text-destructive">
                    {exportError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
        <CadCursorOverlay
          projectId={projectId}
          branchId={branchId}
          surface={cadCursorSurface(active?.id ?? "none")}
          self={cursorSelf}
          reportRef={reportCursorRef}
        />
        <ViewportComments
          projectId={projectId}
          branchId={branchId}
          surface={cadCursorSurface(active?.id ?? "none")}
          viewerId={viewer.data?.id ?? ""}
          toScreen={(point) => ({ x: `${point.x * 100}%`, y: `${point.y * 100}%` })}
          pending={pendingComment}
          onClearPending={() => {
            setPendingComment(null);
            setCommentMode(false);
          }}
        />
        {partDragActive ? (
          <div className="border-primary/70 bg-primary/10 pointer-events-none absolute inset-3 z-[65] flex items-center justify-center rounded-none border-2 border-dashed backdrop-blur-[1px]">
            <div className="bg-card flex items-center gap-2 rounded-none border px-4 py-2.5 font-mono text-[11px] tracking-[0.08em] uppercase shadow-none">
              <Boxes className="text-primary size-4" />
              Drop to place in the product assembly
            </div>
          </div>
        ) : null}
        {peerLock ? (
          <div
            className="bg-card pointer-events-none absolute bottom-28 left-1/2 z-50 flex max-w-[calc(100%_-_1.5rem)] -translate-x-1/2 items-center gap-2 rounded-none border px-2.5 py-1.5 text-[11px] shadow-none"
            role="status"
          >
            <span
              className="flex size-6 items-center justify-center rounded-none"
              style={{ backgroundColor: `${peerLock.color}26`, color: peerLock.color }}
            >
              <Lock className="size-3.5" />
            </span>
            <span>
              <span className="font-medium">{peerLock.name} is editing</span>
              <span className="text-muted-foreground ml-1.5">Read-only</span>
            </span>
          </div>
        ) : null}
        {aiLock.data ? (
          <div
            className="bg-card pointer-events-none absolute bottom-28 left-1/2 z-50 flex max-w-[calc(100%_-_1.5rem)] -translate-x-1/2 items-center gap-2 rounded-none border px-2.5 py-1.5 text-[11px] shadow-none"
            role="status"
          >
            <span className="bg-primary/15 text-primary flex size-6 items-center justify-center rounded-none">
              <Bot className="size-3.5" />
            </span>
            <span>
              <span className="font-medium">{aiLock.data.actorName}&apos;s AI is editing</span>
              <span className="text-muted-foreground ml-1.5">Read-only</span>
            </span>
            <Lock className="text-muted-foreground size-3.5" />
          </div>
        ) : null}
        <div className="bg-card absolute inset-x-0 top-0 z-40 flex h-10 items-center gap-0.5 border-b px-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowTree(!showTree)}
            aria-label={showTree ? "Hide component tree" : "Show component tree"}
          >
            {showTree ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeftOpen className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowCode(!showCode)}
            aria-label={showCode ? "Hide code" : "Show code"}
            className={cn(showCode && "bg-primary/10 text-primary")}
          >
            <Code className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setCommentMode((mode) => !mode);
              setPendingComment(null);
            }}
            aria-label={commentMode ? "Exit comment mode" : "Pin a comment to the viewport"}
            aria-pressed={commentMode}
            title="Pin a comment to the viewport"
            className={cn(commentMode && "bg-primary/10 text-primary")}
          >
            <MessageSquare className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={undo}
            disabled={!editable || !canUndo}
            aria-label="Undo CAD edit"
            title="Undo CAD edit"
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={redo}
            disabled={!editable || !canRedo}
            aria-label="Redo CAD edit"
            title="Redo CAD edit"
          >
            <Redo2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setImportError(null);
              setImportOpen(true);
            }}
            disabled={!editable}
            aria-label="Import design resource"
            title="Import Python, CAD, mesh, drawing, or electronics design files"
          >
            <Upload className="size-4" />
          </Button>
          <div className="bg-border mx-1 h-5 w-px" />
          {isPython ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 font-mono text-[10px] tracking-[0.08em] uppercase"
                onClick={() => void measurement.refetch()}
                disabled={
                  Boolean(localPreview) || isStarter || measurement.isFetching || save.isPending
                }
                title="Measure the saved model"
              >
                <Ruler className="size-3.5" />
                {measurement.isFetching ? "Measuring…" : "Measure"}
              </Button>
              <details className="relative">
                <summary className="hover:bg-muted flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-none px-2 font-mono text-[10px] tracking-[0.08em] uppercase">
                  <Download className="size-3.5" />
                  {exporting ? "Exporting…" : "Export"}
                  <ChevronDown className="size-3" />
                </summary>
                <div className="bg-popover absolute top-full left-0 z-50 mt-1 w-36 rounded-none border p-1 shadow-none">
                  {(["step", "stl"] as const).map((format) => (
                    <button
                      key={format}
                      type="button"
                      disabled={Boolean(localPreview) || isStarter || Boolean(exporting)}
                      onClick={() => void exportCad(format)}
                      className="hover:bg-muted block w-full px-2 py-2 text-left font-mono text-[10px] tracking-[0.08em] uppercase disabled:opacity-40"
                    >
                      Export {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              </details>
            </>
          ) : null}
          <div className="text-muted-foreground ml-2 flex min-w-0 items-center gap-1.5 text-[10px]">
            <span className="text-foreground max-w-52 truncate font-mono">
              {active?.path ?? "No active part"}
            </span>
          </div>
          <div className="text-muted-foreground ml-auto flex items-center gap-2 pr-1 font-mono text-[9px] tracking-[0.08em] uppercase">
            <span>{isPython ? "Python" : isKcl ? "Legacy source" : "Markdown"}</span>
            <span className="bg-border h-3 w-px" />
            <span>{save.isPending ? "Saving…" : "Saved"}</span>
          </div>
        </div>
        <CadImportDialog
          open={importOpen}
          pending={importMesh.isPending}
          error={importError}
          onClose={() => {
            setImportOpen(false);
            setImportError(null);
          }}
          onFile={(file, unit) => void confirmImport(file, unit)}
        />
      </div>
    </div>
  );
}
