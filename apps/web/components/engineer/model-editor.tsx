"use client";

/**
 * Mechanical CAD workspace: multi-component tree (parts / assembly /
 * instructions) + Monaco + live Zoo viewport for the active KCL component.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import Editor from "@monaco-editor/react";
import {
  Bot,
  Boxes,
  ChevronDown,
  ChevronUp,
  Code,
  FilePlus,
  FileText,
  Layers,
  Lock,
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
  addCadComponent,
  displayNameFromCadPath,
  getActiveComponent,
  importMeshAsPart,
  normalizeCadDoc,
  setActiveComponent,
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
import { CadViewport } from "@/components/engineer/cad-viewport";
import { CadFeatureTimeline } from "@/components/engineer/cad-feature-timeline";
import { CadToolsPanel } from "@/components/engineer/cad-tools-panel";
import { useTheme } from "@/components/theme-provider";
import { defineFoundryMonacoThemes } from "@/lib/monaco-theme";
import { monacoThemeFor } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useCursors } from "@/lib/use-cursors";

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
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-card/85 absolute top-3 right-3 z-10 w-60 rounded-none border shadow-lg backdrop-blur-md">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
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
        <div className="max-h-[62vh] overflow-y-auto border-t">
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
}: {
  doc: CadDoc;
  activeId: string;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onAdd: (kind: CadComponentKind) => void;
}) {
  const groups: CadComponentKind[] = ["part", "assembly", "instructions"];
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
      {groups.map((kind) => {
        const meta = KIND_META[kind];
        const Icon = meta.icon;
        const items = doc.components.filter((c) => c.kind === kind);
        return (
          <div key={kind} className="mb-2">
            <div className="text-muted-foreground flex items-center gap-1.5 px-2.5 py-1 text-[12px]">
              <Icon className="size-3 opacity-70" />
              <span className="flex-1 font-medium">{meta.label}</span>
              {canEdit ? (
                <button
                  type="button"
                  title={`Add ${kind}`}
                  onClick={() => onAdd(kind)}
                  className="hover:bg-muted rounded p-0.5"
                >
                  <FilePlus className="size-3" />
                </button>
              ) : null}
            </div>
            {items.map((c) => {
              // Parts live at parts/<name>/main.kcl — show the part name, not "main.kcl".
              const label = c.name || displayNameFromCadPath(c.path);
              const ext = c.kind === "instructions" ? ".md" : ".kcl";
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    "hover:bg-muted/60 flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs",
                    activeId === c.id && "bg-muted text-foreground font-medium",
                  )}
                >
                  <Layers className="text-muted-foreground size-3 shrink-0 opacity-60" />
                  <span className="min-w-0 flex-1 truncate font-mono" title={c.path}>
                    {label}
                    {ext}
                  </span>
                </button>
              );
            })}
            {items.length === 0 ? (
              <p className="text-muted-foreground px-2.5 py-1 text-[11px]">None yet</p>
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

type CadImportUnit = "mm" | "cm" | "m" | "in" | "ft" | "yd";

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

function ImportCadPanel({
  file,
  unit,
  importing,
  error,
  onUnitChange,
  onCancel,
  onImport,
}: {
  file: File;
  unit: CadImportUnit;
  importing: boolean;
  error: string | null;
  onUnitChange: (unit: CadImportUnit) => void;
  onCancel: () => void;
  onImport: () => void;
}) {
  return (
    <div className="bg-background/65 absolute inset-0 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-card w-full max-w-sm rounded-none border shadow-xl">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Import CAD resource</p>
          <p className="text-muted-foreground mt-1 truncate font-mono text-[11px]">{file.name}</p>
        </div>
        <div className="space-y-3 px-4 py-3">
          <div className="bg-muted/50 flex justify-between px-2.5 py-2 text-xs">
            <span className="text-muted-foreground">Size</span>
            <span className="font-mono">{(file.size / 1_048_576).toFixed(2)} MB</span>
          </div>
          <label className="block text-xs">
            <span className="text-muted-foreground mb-1.5 block">
              Source units for unitless mesh formats
            </span>
            <select
              value={unit}
              onChange={(event) => onUnitChange(event.target.value as CadImportUnit)}
              className="border-input bg-background h-9 w-full rounded-none border px-2 text-xs outline-none focus:border-ring"
            >
              <option value="mm">Millimeters</option>
              <option value="cm">Centimeters</option>
              <option value="m">Meters</option>
              <option value="in">Inches</option>
              <option value="ft">Feet</option>
              <option value="yd">Yards</option>
            </select>
          </label>
          <p className="text-muted-foreground text-[10px] leading-relaxed">
            STEP/STP keeps its authored scale. STL, OBJ, and PLY are unitless and use this setting.
            Imported geometry is labeled UNVERIFIED until inspected.
          </p>
          {error ? <p className="text-destructive text-[11px]">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={importing}>
            Cancel
          </Button>
          <Button size="sm" onClick={onImport} disabled={importing}>
            {importing ? "Importing…" : "Import"}
          </Button>
        </div>
      </div>
    </div>
  );
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
  const [execError, setExecError] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [importUnit, setImportUnit] = useState<CadImportUnit>("mm");
  const [importError, setImportError] = useState<string | null>(null);
  const [syncingAfterLock, setSyncingAfterLock] = useState(false);
  const [, setHistoryVersion] = useState(0);
  const dirtyRef = useRef(false);
  const migratedRef = useRef(false);
  const sawLockRef = useRef(false);
  const appliedUpdatedAtRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<{
    past: CadDoc[];
    future: CadDoc[];
    lastRecordedAt: number;
    lastComponentId: string | null;
  }>({ past: [], future: [], lastRecordedAt: 0, lastComponentId: null });
  const saveRef = useRef(save);
  saveRef.current = save;
  const locked = Boolean(aiLock.data);
  const editable = canEdit && !locked && !syncingAfterLock;

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
    if (dirtyRef.current && !serverIsNew) return;

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

  async function confirmImport() {
    if (!pendingImport || !doc || !editable) return;
    setImportError(null);
    if (pendingImport.size > 10_000_000) {
      setImportError("File exceeds the 10 MB CAD import limit.");
      return;
    }
    try {
      const contentBase64 = await fileToBase64(pendingImport);
      const result = await importMesh.mutateAsync({
        projectId,
        branchId,
        filename: pendingImport.name,
        contentBase64,
        lengthUnit: importUnit,
      });
      const next = importMeshAsPart(doc, result.asset);
      setActiveId(next.activeId);
      setSelectedFeatureId(null);
      persist(next, { checkpoint: true, activeIdOverride: next.activeId });
      setPendingImport(null);
      if (importInputRef.current) importInputRef.current.value = "";
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "CAD import failed");
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
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  if (doc === null || engine.isLoading) {
    return <DotMatrixLoader className="absolute inset-0" label="Loading CAD" />;
  }

  if (engine.error || !engine.data) {
    return (
      <div className="text-destructive absolute inset-0 flex items-center justify-center p-8 text-center text-sm">
        {engine.error?.message ??
          "Zoo CAD is not configured. Set ZOO_API_TOKEN in the root .env and restart."}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex">
      {showTree ? (
        <div className="bg-card/40 flex w-52 shrink-0 flex-col border-r">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
            <Boxes className="text-primary size-3.5" />
            <span className="text-xs font-medium">CAD workspace</span>
          </div>
          <ComponentTree
            doc={doc}
            activeId={activeId ?? doc.activeId}
            canEdit={editable}
            onSelect={onSelect}
            onAdd={onAdd}
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
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          reportCursorRef.current?.(
            normalizedCursorCoordinate((event.clientX - rect.left) / rect.width),
            normalizedCursorCoordinate((event.clientY - rect.top) / rect.height),
          );
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
                measureError={measurement.error?.message}
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
                chrome
                projectFiles={viewport.projectFiles}
                entryPath={viewport.entryPath}
                meshAssets={viewport.meshAssets}
                foreignImportOnly={viewport.foreignImportOnly}
                onError={setExecError}
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
        {aiLock.data ? (
          <div
            className="bg-card/95 pointer-events-none absolute top-14 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur-md"
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
        <div className="absolute top-3 left-3 z-30 flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setShowTree(!showTree)}
            aria-label={showTree ? "Hide component tree" : "Show component tree"}
            className="bg-card/90 shadow backdrop-blur-md"
          >
            {showTree ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeftOpen className="size-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setShowCode(!showCode)}
            aria-label={showCode ? "Hide code" : "Show code"}
            className={cn("bg-card/90 shadow backdrop-blur-md", showCode && "bg-muted")}
          >
            <Code className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={undo}
            disabled={!editable || !canUndo}
            aria-label="Undo CAD edit"
            title="Undo CAD edit"
            className="bg-card/90 shadow backdrop-blur-md"
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={redo}
            disabled={!editable || !canRedo}
            aria-label="Redo CAD edit"
            title="Redo CAD edit"
            className="bg-card/90 shadow backdrop-blur-md"
          >
            <Redo2 className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => importInputRef.current?.click()}
            disabled={!editable}
            aria-label="Import CAD resource"
            title="Import STEP, STL, OBJ, GLTF, GLB, or PLY"
            className="bg-card/90 shadow backdrop-blur-md"
          >
            <Upload className="size-4" />
          </Button>
          <input
            ref={importInputRef}
            type="file"
            hidden
            accept=".step,.stp,.stl,.obj,.gltf,.glb,.ply"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setImportError(null);
              setPendingImport(file);
            }}
          />
        </div>
        {pendingImport ? (
          <ImportCadPanel
            file={pendingImport}
            unit={importUnit}
            importing={importMesh.isPending}
            error={importError}
            onUnitChange={setImportUnit}
            onCancel={() => {
              setPendingImport(null);
              setImportError(null);
              if (importInputRef.current) importInputRef.current.value = "";
            }}
            onImport={() => void confirmImport()}
          />
        ) : null}
      </div>
    </div>
  );
}
