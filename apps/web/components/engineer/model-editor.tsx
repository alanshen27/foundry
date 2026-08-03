"use client";

/**
 * Mechanical CAD workspace: multi-component tree (parts / assembly /
 * instructions) + Monaco + live Zoo viewport for the active KCL component.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import Editor from "@monaco-editor/react";
import {
  Bot,
  Axis3d,
  Boxes,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code,
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
  SlidersHorizontal,
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
  importMeshAsPart,
  insertPartIntoAssembly,
  normalizeCadDoc,
  setActiveComponent,
  slugifyCadName,
  upsertPartScript,
  updateComponentContent,
  type CadComponent,
  type CadComponentKind,
  type CadDoc,
} from "@/lib/cad/engine";
import {
  parseCadFeatureFields,
  parseCadFeatures,
  setCadFeatureField,
  type CadFeature,
  type CadFeatureField,
} from "@/lib/cad/features";
import { parseCadParams, setCadParam, type CadParam } from "@/lib/cad/params";
import { cadViewportInput } from "@/lib/cad/viewport-project";
import { orientationForView, type CameraOrientation } from "@/lib/cad/viewport-input";
import { CadViewport } from "@/components/engineer/cad-viewport";
import { CadFeatureTimeline } from "@/components/engineer/cad-feature-timeline";
import { CadImportDialog, type CadImportUnit } from "@/components/engineer/cad-import-dialog";
import { CadToolsPanel } from "@/components/engineer/cad-tools-panel";
import { CadTransformGizmo } from "@/components/engineer/cad-transform-gizmo";
import { applyCadTool, findLastSolid } from "@/lib/cad/tools";
import { safeCadError } from "@/lib/cad/safe-error";
import { useTheme } from "@/components/theme-provider";
import { defineFoundryMonacoThemes } from "@/lib/monaco-theme";
import { monacoThemeFor } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useCursors } from "@/lib/use-cursors";
import { useLiveEdit } from "@/lib/use-live-edit";
import { ViewportComments, type CommentPoint } from "@/components/engineer/viewport-comments";

type CadMeasurement = {
  unit: "mm";
  center: { x: number; y: number; z: number };
  dimensions: { x: number; y: number; z: number };
};

function ParamsPanel({
  params,
  inlineFields,
  feature,
  measurement,
  measuring,
  measureError,
  canEdit,
  onSet,
  onSetInline,
  onMeasure,
}: {
  params: CadParam[];
  inlineFields: CadFeatureField[];
  feature: CadFeature | null;
  measurement?: CadMeasurement;
  measuring: boolean;
  measureError?: string;
  canEdit: boolean;
  onSet: (name: string, value: number | boolean | string) => void;
  onSetInline: (field: CadFeatureField, value: number) => void;
  onMeasure: () => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    if (feature) setCollapsed(false);
  }, [feature?.id]);

  return (
    <div className="bg-card/90 absolute top-32 right-3 z-30 w-64 rounded-lg border shadow-lg backdrop-blur-md">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-controls="cad-inspector-content"
        className="flex w-full items-center gap-2 px-3 py-2"
      >
        <SlidersHorizontal className="text-primary size-3.5" />
        <span className="text-xs font-semibold">Inspector</span>
        <span className="text-muted-foreground ml-auto text-[10px]">
          {feature?.operation ?? "part"}
        </span>
        {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
      </button>
      {!collapsed ? (
        <div id="cad-inspector-content" className="max-h-[62vh] overflow-y-auto border-t">
          {feature ? (
            <div className="border-b px-3 py-2.5">
              <p className="truncate text-xs font-medium" title={feature.label}>
                {feature.label}
              </p>
              <p className="text-muted-foreground mt-1 flex justify-between font-mono text-[10px]">
                <span>{feature.kind}</span>
                <span>
                  L{feature.lineStart}–{feature.lineEnd}
                </span>
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5 px-3 py-2.5">
            <p className="text-muted-foreground mb-0.5 text-[10px] font-medium tracking-wide uppercase">
              {feature ? "Feature parameters" : "Part parameters"}
            </p>
            {params.length === 0 && inlineFields.length === 0 ? (
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                {feature
                  ? "This feature has no exposed top-level parameters. Open code for advanced edits."
                  : "No editable top-level parameters were found."}
              </p>
            ) : (
              <>
                {params.map((param) => (
                  <label key={param.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="text-muted-foreground min-w-0 flex-1 truncate"
                      title={param.name}
                    >
                      {param.name}
                    </span>
                    {typeof param.value === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={param.value}
                        disabled={!canEdit}
                        onChange={(e) => onSet(param.name, e.target.checked)}
                        className="accent-primary size-3.5"
                      />
                    ) : typeof param.value === "number" ? (
                      <input
                        type="number"
                        value={param.value}
                        disabled={!canEdit}
                        step={Number.isInteger(param.value) ? 1 : 0.1}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n)) onSet(param.name, n);
                        }}
                        className={cn(
                          "bg-background w-20 rounded-none border px-1.5 py-0.5 text-right font-mono text-xs outline-none",
                          "focus:border-ring",
                        )}
                      />
                    ) : (
                      <input
                        type="text"
                        value={param.value}
                        disabled={!canEdit}
                        onChange={(e) => onSet(param.name, e.target.value)}
                        className="bg-background w-24 rounded-none border px-1.5 py-0.5 font-mono text-xs outline-none focus:border-ring"
                      />
                    )}
                  </label>
                ))}
                {inlineFields.map((field) => (
                  <label key={field.id} className="flex items-center gap-2 text-xs">
                    <span
                      className="text-muted-foreground min-w-0 flex-1 truncate"
                      title={field.name}
                    >
                      {field.name}
                    </span>
                    <span className="relative">
                      <input
                        type="number"
                        value={field.value}
                        disabled={!canEdit}
                        step={Number.isInteger(field.value) ? 1 : 0.1}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value)) onSetInline(field, value);
                        }}
                        className={cn(
                          "bg-background w-20 rounded-none border px-1.5 py-0.5 text-right font-mono text-xs outline-none",
                          field.unit && "pr-7",
                          "focus:border-ring",
                        )}
                      />
                      {field.unit ? (
                        <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 font-mono text-[9px]">
                          {field.unit}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </>
            )}
          </div>

          <div className="border-t px-3 py-2.5">
            <button
              type="button"
              onClick={onMeasure}
              disabled={measuring}
              className="hover:bg-muted flex w-full items-center justify-center gap-1.5 rounded-none border px-2 py-1.5 text-[11px] font-medium disabled:opacity-60"
            >
              <Ruler className="size-3.5" />
              {measuring ? "Measuring with Zoo…" : "Measure overall"}
            </button>
            {measurement ? (
              <div className="mt-2 grid grid-cols-3 gap-1">
                {(["x", "y", "z"] as const).map((axis) => (
                  <div key={axis} className="bg-muted/50 px-1.5 py-1 text-center">
                    <p className="text-muted-foreground text-[9px] uppercase">{axis}</p>
                    <p className="font-mono text-[10px]">
                      {measurement.dimensions[axis].toFixed(2)} {measurement.unit}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
            {measureError ? (
              <p className="text-destructive mt-2 text-[10px] leading-relaxed">{measureError}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const KIND_META: Record<CadComponentKind, { label: string; icon: typeof Puzzle; folder: string }> =
  {
    part: { label: "Manufacturing", icon: Puzzle, folder: "parts/" },
    assembly: { label: "Preview", icon: Boxes, folder: "assembly/" },
    instructions: { label: "Instructions", icon: FileText, folder: "docs/" },
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
      <div className="mx-2 my-2 overflow-hidden rounded-lg border">
        <div className="text-muted-foreground px-2.5 pt-2 text-[9px] font-semibold tracking-wider uppercase">
          Project data
        </div>
        <button
          type="button"
          onClick={onImport}
          disabled={!canEdit}
          className="hover:bg-muted/60 flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs disabled:opacity-40"
        >
          <Upload className="text-primary size-3.5" />
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
            <div className="text-muted-foreground flex items-center px-1.5 py-0.5 text-[12px]">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenGroups((current) => ({ ...current, [kind]: !open }))}
                className="hover:bg-muted flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left"
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
                  className="hover:bg-muted ml-1 rounded p-1"
                >
                  <FilePlus className="size-3" />
                </button>
              ) : null}
            </div>
            {open ? (
              <>
                {items.map((c) => {
                  // Parts live at parts/<name>/main.kcl — show the part name, not "main.kcl".
                  const label = c.name || displayNameFromCadPath(c.path);
                  const ext = c.kind === "instructions" ? ".md" : ".kcl";
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
                        "hover:bg-muted/60 flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs",
                        activeId === c.id && "bg-muted text-foreground font-medium",
                        canDropPart && "border-primary/0 hover:border-primary/30 border-y",
                        kind === "part" && canEdit && "cursor-grab active:cursor-grabbing",
                      )}
                    >
                      <Layers className="text-muted-foreground size-3 shrink-0 opacity-60" />
                      <span className="min-w-0 flex-1 truncate font-mono">
                        {label}
                        {ext}
                      </span>
                      {imported ? (
                        <span className="bg-primary/10 text-primary rounded px-1 py-0.5 text-[8px] font-medium">
                          imported
                        </span>
                      ) : null}
                      {kind === "part" && canEdit ? (
                        <GripVertical
                          className="text-muted-foreground size-3 shrink-0"
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
            className="absolute top-4 left-3 rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-[#0b0b0b] shadow"
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
   * the in-editor selection. Parent keeps one ModelEditor mounted so the Zoo
   * viewport session is reused across part tabs.
   */
  onOpenComponent?: (component: { id: string; name: string }) => void;
}) {
  const { theme } = useTheme();
  const monacoTheme = monacoThemeFor(theme.mode);
  const query = trpc.design.get.useQuery(
    { projectId, branchId, kind: "MODEL3D" },
    {
      // Collab + save mutations invalidate; avoid hammering Auth/DB every 1.5s.
      staleTime: 5_000,
      refetchOnWindowFocus: true,
    },
  );
  const engine = trpc.cad.engineSession.useQuery({ projectId });
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
  const [showGizmo, setShowGizmo] = useState(true);
  const [partDragActive, setPartDragActive] = useState(false);
  const [cameraOrientation, setCameraOrientation] = useState<CameraOrientation>(() =>
    orientationForView("iso"),
  );
  const [execError, setExecError] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
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

  // Human soft locks per component: while a collaborator edits a part's KCL,
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
  const editable = canEdit && !locked && !syncingAfterLock && !peerLock;

  const measurement = trpc.cad.measure.useQuery(
    { projectId, branchId, componentId: activeId ?? "" },
    { enabled: false, retry: false },
  );

  useEffect(() => {
    if (!query.isFetched) return;
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
    appliedUpdatedAtRef.current = serverUpdatedAt;
    dirtyRef.current = false;
    setDoc(next);
    setActiveId((prev) => {
      if (focusComponentId && next.components.some((c) => c.id === focusComponentId)) {
        return focusComponentId;
      }
      return prev && next.components.some((c) => c.id === prev) ? prev : next.activeId;
    });

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
  }, [query.data, query.isFetched, editable, projectId, branchId, focusComponentId]);

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
          data: normalizedNext,
        },
        {
          onSuccess: (saved) => {
            dirtyRef.current = false;
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
    setSelectedFeatureId(null);
    setActiveId(id);
  }

  function onAdd(kind: CadComponentKind) {
    if (!doc || !editable) return;
    const base = kind === "part" ? "part" : kind === "assembly" ? "assembly" : "instructions";
    const n = doc.components.filter((c) => c.kind === kind).length + 1;
    const next = addCadComponent(doc, { name: `${base}-${n}`, kind });
    setActiveId(next.activeId);
    setSelectedFeatureId(null);
    persist(next, { checkpoint: true, activeIdOverride: next.activeId });
  }

  function onInsertPart(assemblyId: string, partId: string) {
    if (!doc || !editable) return;
    const next = insertPartIntoAssembly(doc, assemblyId, partId);
    if (next === doc) return;
    setActiveId(assemblyId);
    setSelectedFeatureId(null);
    persist(next, { checkpoint: true, activeIdOverride: assemblyId });
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
    setSelectedFeatureId(null);
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
    setSelectedFeatureId(null);
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
      if (mode === "native-kcl") {
        const source = (await file.text()).trim();
        if (!source) throw new Error("The selected KCL file is empty.");
        next = upsertPartScript(addCadAsset(doc, result.asset), result.asset.name, source);
      } else {
        next = importMeshAsPart(doc, result.asset);
      }
      setActiveId(next.activeId);
      setSelectedFeatureId(null);
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
  const isKcl = active?.kind === "part" || active?.kind === "assembly";
  const reportCursorRef = useRef<((x: number, y: number) => void) | null>(null);
  const cursorSelf = {
    userId: viewer.data?.id ?? "anonymous",
    name: viewer.data?.name ?? "Someone",
  };

  // Debounce the whole document rather than just the active script: an assembly
  // renders from every part it imports, so the engine needs one consistent
  // snapshot instead of a single file that may be newer than its siblings.
  const [settled, setSettled] = useState<{ doc: CadDoc; activeId: string } | null>(null);
  useEffect(() => {
    if (!viewDoc || !active || !isKcl) {
      setSettled(null);
      return;
    }
    const delay =
      active.content.length > 12_000 ? 1_400 : active.content.length > 4_000 ? 900 : 500;
    const timer = setTimeout(() => setSettled({ doc: viewDoc, activeId: active.id }), delay);
    return () => clearTimeout(timer);
  }, [viewDoc, active?.id, active?.content, isKcl]);

  const viewport = useMemo(
    () => (settled ? cadViewportInput(settled.doc, settled.activeId) : null),
    [settled],
  );

  const params = useMemo(
    () => (isKcl && active ? parseCadParams(active.content) : []),
    [isKcl, active?.content],
  );
  const features = useMemo(
    () => (isKcl && active ? parseCadFeatures(active.content) : []),
    [isKcl, active?.content],
  );
  const selectedFeature = features.find((feature) => feature.id === selectedFeatureId) ?? null;
  const visibleParams = selectedFeature
    ? params.filter((param) => selectedFeature.parameterNames.includes(param.name))
    : params;
  const inlineFields = selectedFeature ? parseCadFeatureFields(selectedFeature) : [];
  const targetSolid =
    selectedFeature?.isSolid && selectedFeature.kind !== "import" ? selectedFeature.binding : null;
  const manipulatorTarget = isKcl && active ? (targetSolid ?? findLastSolid(active.content)) : null;
  const canvasAssemblyId = doc
    ? assemblyDropTargetId(doc, active?.id ?? activeId ?? undefined)
    : null;
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  function applyManipulatorTranslate(axis: "X" | "Y" | "Z", distanceMm: number) {
    if (!active || !isKcl || !manipulatorTarget) return;
    const values = {
      x: axis === "X" ? distanceMm : 0,
      y: axis === "Y" ? distanceMm : 0,
      z: axis === "Z" ? distanceMm : 0,
    };
    const result = applyCadTool(active.content, "translate", values, {
      targetSolid: manipulatorTarget,
    });
    onChangeContent(result.script, true);
  }

  function applyManipulatorRotate(axis: "X" | "Y" | "Z", degrees: number) {
    if (!active || !isKcl || !manipulatorTarget) return;
    const result = applyCadTool(
      active.content,
      "rotate",
      {
        roll: axis === "X" ? degrees : 0,
        pitch: axis === "Y" ? degrees : 0,
        yaw: axis === "Z" ? degrees : 0,
      },
      { targetSolid: manipulatorTarget },
    );
    onChangeContent(result.script, true);
  }

  if (doc === null || engine.isLoading) {
    return <DotMatrixLoader className="absolute inset-0" label="Loading CAD" />;
  }

  if (engine.error || !engine.data) {
    return (
      <div className="text-destructive absolute inset-0 flex items-center justify-center p-8 text-center text-sm">
        {safeCadError(engine.error ?? new Error("CAD service is not configured"), "session")}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex">
      {showTree ? (
        <div className="bg-card/55 flex w-60 shrink-0 flex-col border-r">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
            <Boxes className="text-primary size-3.5" />
            <span className="text-xs font-semibold">Design browser</span>
            <span className="text-muted-foreground ml-auto text-[9px]">KCL</span>
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
          <div className="bg-card/60 flex h-9 shrink-0 items-center gap-2 border-b px-3">
            <span className="truncate font-mono text-xs font-medium" title={active?.path}>
              {active
                ? `${active.name || displayNameFromCadPath(active.path)}${
                    active.kind === "instructions" ? ".md" : ".kcl"
                  }`
                : "—"}
            </span>
            <span className="text-muted-foreground ml-auto text-[11px]">
              {save.isPending ? "Saving…" : "Autosaves"}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <Editor
              key={`${monacoTheme}-${active?.id ?? "none"}`}
              language={isKcl ? "javascript" : "markdown"}
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
          {execError && isKcl ? (
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
            {active && isKcl ? (
              <ParamsPanel
                params={visibleParams}
                inlineFields={inlineFields}
                feature={selectedFeature}
                measurement={measurement.data}
                measuring={measurement.isFetching}
                measureError={
                  measurement.error ? safeCadError(measurement.error, "execution") : undefined
                }
                canEdit={editable}
                onSet={(name, value) => onChangeContent(setCadParam(active.content, name, value))}
                onSetInline={(field, value) => {
                  if (!selectedFeature) return;
                  onChangeContent(
                    setCadFeatureField(active.content, selectedFeature, field, value),
                  );
                }}
                onMeasure={() => void measurement.refetch()}
              />
            ) : null}
            {viewport ? (
              <CadViewport
                script={viewport.script}
                engine={engine.data}
                view="orbit"
                chrome={true}
                projectFiles={viewport.projectFiles}
                entryPath={viewport.entryPath}
                meshAssets={viewport.meshAssets}
                foreignImportOnly={viewport.foreignImportOnly}
                onError={setExecError}
                onCameraOrientationChange={setCameraOrientation}
              />
            ) : null}
            {showGizmo && manipulatorTarget ? (
              <CadTransformGizmo
                target={manipulatorTarget}
                canEdit={editable}
                orientation={cameraOrientation}
                onTranslate={applyManipulatorTranslate}
                onRotate={applyManipulatorRotate}
              />
            ) : null}
            {active && isKcl ? (
              <CadToolsPanel
                script={active.content}
                canEdit={editable}
                targetSolid={targetSolid}
                onApply={(next) => onChangeContent(next, true)}
              />
            ) : null}
            <CadFeatureTimeline
              features={features}
              selectedId={selectedFeature?.id ?? null}
              onSelect={(feature) => setSelectedFeatureId(feature?.id ?? null)}
            />
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
          <div className="border-primary/70 bg-primary/10 pointer-events-none absolute inset-3 z-[65] flex items-center justify-center rounded-xl border-2 border-dashed backdrop-blur-[1px]">
            <div className="bg-card/95 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg">
              <Boxes className="text-primary size-4" />
              Drop to place in the product assembly
            </div>
          </div>
        ) : null}
        {peerLock ? (
          <div
            className="bg-card/95 pointer-events-none absolute top-32 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur-md"
            role="status"
          >
            <span
              className="flex size-6 items-center justify-center rounded-md"
              style={{ backgroundColor: `${peerLock.color}26`, color: peerLock.color }}
            >
              <Lock className="size-3.5" />
            </span>
            <span>
              <span className="font-semibold">{peerLock.name} is editing this part</span>
              <span className="text-muted-foreground ml-1.5">read-only until they finish</span>
            </span>
          </div>
        ) : null}
        {aiLock.data ? (
          <div
            className="bg-card/95 pointer-events-none absolute top-32 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur-md"
            role="status"
          >
            <span className="bg-primary/15 text-primary flex size-6 items-center justify-center rounded-md">
              <Bot className="size-3.5" />
            </span>
            <span>
              <span className="font-semibold">{aiLock.data.actorName}&apos;s AI is editing</span>
              <span className="text-muted-foreground ml-1.5">CAD locked for everyone</span>
            </span>
            <Lock className="text-muted-foreground size-3.5" />
          </div>
        ) : null}
        <div className="bg-card/95 absolute inset-x-0 top-0 z-40 flex h-10 items-center gap-1 border-b px-2 shadow-sm backdrop-blur-md">
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
            className={cn(showCode && "bg-muted")}
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
            className={cn(commentMode && "bg-muted")}
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
            title="Import CAD, mesh, drawing, KCL, or electronics design files"
          >
            <Upload className="size-4" />
          </Button>
          <div className="bg-border mx-1 h-5 w-px" />
          <Button
            variant={showGizmo ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowGizmo((shown) => !shown)}
            disabled={!manipulatorTarget}
            aria-pressed={showGizmo}
            title="Toggle the in-canvas move and rotate manipulator"
            className="h-7 gap-1.5 px-2 text-[10px]"
          >
            <Axis3d className="size-3.5" />
            Move / Copy
          </Button>
          <div className="text-muted-foreground ml-2 flex min-w-0 items-center gap-1.5 text-[10px]">
            <span className="text-primary font-semibold tracking-wider">DESIGN</span>
            <span>/</span>
            <span className="text-foreground max-w-52 truncate font-mono">
              {active?.path ?? "No active part"}
            </span>
          </div>
          <div className="text-muted-foreground ml-auto flex items-center gap-2 pr-1 text-[10px]">
            <span>{features.length} features</span>
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
