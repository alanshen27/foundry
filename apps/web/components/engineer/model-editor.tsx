"use client";

/**
 * Mechanical CAD workspace: multi-component tree (parts / assembly /
 * instructions) + Monaco + live Zoo viewport for the active KCL component.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  Code,
  FilePlus,
  FileText,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addCadComponent,
  getActiveComponent,
  normalizeCadDoc,
  setActiveComponent,
  updateComponentContent,
  type CadComponent,
  type CadComponentKind,
  type CadDoc,
} from "@/lib/cad/engine";
import { parseCadParams, setCadParam, type CadParam } from "@/lib/cad/params";
import { cadViewportInput } from "@/lib/cad/viewport-project";
import { CadViewport } from "@/components/engineer/cad-viewport";
import { CadToolsPanel } from "@/components/engineer/cad-tools-panel";
import { useTheme } from "@/components/theme-provider";
import { monacoThemeFor } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

function ParamsPanel({
  params,
  canEdit,
  onSet,
}: {
  params: CadParam[];
  canEdit: boolean;
  onSet: (name: string, value: number | boolean | string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-card/85 absolute top-3 right-3 z-10 w-60 rounded-xl border shadow-lg backdrop-blur-md">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 px-3 py-2"
      >
        <SlidersHorizontal className="text-primary size-3.5" />
        <span className="text-xs font-semibold">Parameters</span>
        <span className="text-muted-foreground ml-auto text-[10px]">{params.length}</span>
        {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
      </button>
      {!collapsed ? (
        <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto border-t px-3 py-2.5">
          {params.map((param) => (
            <label key={param.name} className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground min-w-0 flex-1 truncate" title={param.name}>
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
                    "bg-background w-20 rounded-md border px-1.5 py-0.5 text-right font-mono text-xs outline-none",
                    "focus:border-ring",
                  )}
                />
              ) : (
                <input
                  type="text"
                  value={param.value}
                  disabled={!canEdit}
                  onChange={(e) => onSet(param.name, e.target.value)}
                  className="bg-background w-24 rounded-md border px-1.5 py-0.5 font-mono text-xs outline-none focus:border-ring"
                />
              )}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const KIND_META: Record<
  CadComponentKind,
  { label: string; icon: typeof Puzzle; folder: string }
> = {
  part: { label: "Parts", icon: Puzzle, folder: "parts/" },
  assembly: { label: "Assembly", icon: Boxes, folder: "assembly/" },
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
              const file = c.path.split("/").pop() ?? c.name;
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
                    {file}
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

export function ModelEditor({
  projectId,
  branchId,
  canEdit,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
}) {
  const { theme } = useTheme();
  const monacoTheme = monacoThemeFor(theme.mode);
  const query = trpc.design.get.useQuery({ projectId, branchId, kind: "MODEL3D" });
  const engine = trpc.cad.engineSession.useQuery({ projectId });
  const save = trpc.design.save.useMutation();

  const [doc, setDoc] = useState<CadDoc | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(true);
  const [showCode, setShowCode] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const migratedRef = useRef(false);
  const appliedUpdatedAtRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

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
    setActiveId((prev) =>
      prev && next.components.some((c) => c.id === prev) ? prev : next.activeId,
    );

    const raw = query.data?.data as { version?: unknown } | null | undefined;
    if (
      canEdit &&
      !migratedRef.current &&
      raw &&
      typeof raw === "object" &&
      raw.version !== 5
    ) {
      migratedRef.current = true;
      saveRef.current.mutate({
        projectId,
        branchId,
        kind: "MODEL3D",
        data: next,
      });
    }
  }, [query.data, query.isFetched, canEdit, projectId, branchId]);

  function persist(next: CadDoc) {
    setDoc(next);
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const toSave = activeId ? setActiveComponent(next, activeId) : next;
      saveRef.current.mutate(
        {
          projectId,
          branchId,
          kind: "MODEL3D",
          data: toSave,
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
    setActiveId(id);
  }

  function onAdd(kind: CadComponentKind) {
    if (!doc || !canEdit) return;
    const base =
      kind === "part" ? "part" : kind === "assembly" ? "assembly" : "instructions";
    const n = doc.components.filter((c) => c.kind === kind).length + 1;
    const next = addCadComponent(doc, { name: `${base}-${n}`, kind });
    setActiveId(next.activeId);
    persist(next);
  }

  function onChangeContent(next: string | undefined) {
    if (!canEdit || !doc || !activeId || next === undefined) return;
    const current = doc.components.find((c) => c.id === activeId);
    if (!current) return;
    if ((current.kind === "part" || current.kind === "assembly") && !next.trim()) return;
    persist(updateComponentContent(doc, activeId, next));
  }

  const viewDoc: CadDoc | null = useMemo(
    () => (doc && activeId ? setActiveComponent(doc, activeId) : doc),
    [doc, activeId],
  );
  const active: CadComponent | null = viewDoc ? getActiveComponent(viewDoc) : null;
  const isKcl = active?.kind === "part" || active?.kind === "assembly";

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

  if (doc === null || engine.isLoading) {
    return (
      <div className="absolute inset-0 flex" aria-busy="true" aria-label="Loading CAD workspace">
        <div className="hidden w-56 shrink-0 flex-col border-r md:flex">
          <Skeleton className="h-9 rounded-none border-b" />
          <Skeleton className="min-h-0 flex-1 rounded-none" />
        </div>
        <Skeleton className="hidden w-[380px] shrink-0 rounded-none border-r md:block" />
        <Skeleton className="min-w-0 flex-1 rounded-none" />
      </div>
    );
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
            canEdit={canEdit}
            onSelect={onSelect}
            onAdd={onAdd}
          />
        </div>
      ) : null}

      {showCode ? (
        <div className="flex min-w-0 w-[min(42%,420px)] shrink-0 flex-col border-r">
          <div className="bg-card/60 flex h-9 shrink-0 items-center gap-2 border-b px-3">
            <span className="truncate font-mono text-xs font-medium" title={active?.path}>
              {active?.path ?? "—"}
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
              value={active?.content ?? ""}
              onChange={onChangeContent}
              options={{
                readOnly: !canEdit,
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

      <div className="bg-background relative min-w-0 flex-1">
        {active?.kind === "instructions" ? (
          <InstructionsPreview content={active.content} />
        ) : (
          <>
            {params.length > 0 && active ? (
              <ParamsPanel
                params={params}
                canEdit={canEdit}
                onSet={(name, value) =>
                  onChangeContent(setCadParam(active.content, name, value))
                }
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
                canEdit={canEdit}
                onApply={onChangeContent}
              />
            ) : null}
          </>
        )}
        <div className="absolute top-3 left-3 z-30 flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setShowTree(!showTree)}
            aria-label={showTree ? "Hide component tree" : "Show component tree"}
            className="bg-card/90 shadow backdrop-blur-md"
          >
            {showTree ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
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
        </div>
      </div>
    </div>
  );
}
