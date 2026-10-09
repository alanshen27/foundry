"use client";

/**
 * Engineer home: the linked product assembly, built from preserved part sources.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Boxes, CircuitBoard, Package, RefreshCw, Waypoints } from "lucide-react";
import { DotMatrixLoader } from "@/components/dot-matrix-loader";
import { CadViewport } from "@/components/engineer/cad-viewport";
import { isCadStarterComponent, normalizeCadDoc, pickCadAssemblyPreview } from "@/lib/cad/engine";
import { cadViewportInput } from "@/lib/cad/viewport-project";
import { normalizePcbSet, type PcbSet } from "@/lib/pcb/doc";
import { formatCents } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { LEGACY_CAD_PREVIEW_MESSAGE } from "@/lib/cad/safe-error";
import { createLogger } from "@foundry/observability";

const log = createLogger("assembly");

export type AssemblyOpenTarget =
  | "pcb"
  | "schematic"
  | { editor: "model"; componentId?: string; label?: string }
  | { editor: "pcb"; boardId: string; label?: string };

type Props = {
  projectId: string;
  branchId: string;
  onOpenEditor?: (target: AssemblyOpenTarget) => void;
};

type SceneTarget = {
  id: string;
  name: string;
  kind: "mechanical" | "pcb";
  detail: string;
  /** Manufacturing-part id used to highlight the matching 3D instance. */
  componentId: string;
  open: AssemblyOpenTarget;
};

function sceneTargetsFromDoc(
  cadDoc: ReturnType<typeof normalizeCadDoc>,
  pcbSet: PcbSet | null,
): SceneTarget[] {
  const boards = pcbSet?.boards ?? [];
  const boardIds = new Set(boards.map((board) => board.id ?? "board-1"));
  const pcbPartId = (boardId: string) =>
    cadDoc.components.find(
      (component) => component.source?.kind === "pcb" && component.source.boardId === boardId,
    )?.id;
  const parts = cadDoc.components.filter(
    (c) =>
      c.kind === "part" &&
      !isCadStarterComponent(c) &&
      !(c.source?.kind === "pcb" && boardIds.has(c.source.boardId)),
  );
  const out: SceneTarget[] = parts.map((c) => ({
    id: c.id,
    name: c.name,
    kind: "mechanical" as const,
    detail: c.path,
    componentId: c.id,
    open: { editor: "model" as const, componentId: c.id, label: c.name },
  }));
  for (const board of boards) {
    const boardId = board.id ?? "board-1";
    out.push({
      id: `pcb:${boardId}`,
      name: board.name ?? "PCB",
      kind: "pcb",
      detail: `${board.board.widthMm} × ${board.board.heightMm} mm · ${board.footprints.length} placements`,
      componentId: pcbPartId(boardId) ?? `pcb:${boardId}`,
      open: { editor: "pcb", boardId, label: board.name },
    });
  }
  return out;
}

export function AssemblyView({ projectId, branchId, onOpenEditor }: Props) {
  const utils = trpc.useUtils();
  const model = trpc.design.get.useQuery({ projectId, branchId, kind: "MODEL3D" });
  const pcb = trpc.design.get.useQuery({ projectId, branchId, kind: "PCB" });
  const components = trpc.engineer.listComponents.useQuery({ projectId, branchId });
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewportEpoch, setViewportEpoch] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const loading = (model.isLoading || pcb.isLoading) && !syncing;

  const syncFromServer = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await Promise.all([
        utils.design.get.invalidate({ projectId, branchId, kind: "MODEL3D" }),
        utils.design.get.invalidate({ projectId, branchId, kind: "PCB" }),
        utils.engineer.listComponents.invalidate({ projectId, branchId }),
      ]);
      await Promise.all([
        utils.design.get.refetch({ projectId, branchId, kind: "MODEL3D" }),
        utils.design.get.refetch({ projectId, branchId, kind: "PCB" }),
        utils.engineer.listComponents.refetch({ projectId, branchId }),
      ]);
      setViewportEpoch((n) => n + 1);
    } finally {
      setSyncing(false);
    }
  }, [utils, projectId, branchId]);

  const cadDoc = useMemo(
    () => (model.data?.data ? normalizeCadDoc(model.data.data) : null),
    [model.data],
  );
  const pcbSet = useMemo(
    () => (pcb.data?.data ? normalizePcbSet(pcb.data.data) : null),
    [pcb.data],
  );

  const preview = useMemo(() => (cadDoc ? pickCadAssemblyPreview(cadDoc) : null), [cadDoc]);
  const product = preview?.component ?? null;

  const viewportResult = useMemo(() => {
    try {
      return { data: cadDoc && product ? cadViewportInput(cadDoc, product.id) : null, error: null };
    } catch {
      return {
        data: null,
        error:
          "A referenced CAD file is missing or unavailable. Restore the import or update the source part.",
      };
    }
  }, [cadDoc, product]);
  const viewport = viewportResult.data;

  useEffect(() => {
    if (!product || !viewport) {
      log.debug("no assembly/product.kcl to render");
      return;
    }
    // The assembled source is a build artefact, not what the editor shows, so
    // it stays available while developing — but printing every project's
    // geometry into a user's console is noise.
    if (process.env.NODE_ENV === "production") return;
    // Deliberately raw console: a collapsible devtools group of the generated
    // source is the point here, and it never runs in production.
    console.groupCollapsed(`[Assembly] product assembly · ${product.path}`);
    console.log(viewport.script);
    if (viewport.projectFiles) {
      console.log("project files", Object.keys(viewport.projectFiles).sort());
    }
    console.groupEnd();
  }, [product, viewport]);

  const sceneTargets = useMemo(
    () => (cadDoc ? sceneTargetsFromDoc(cadDoc, pcbSet) : []),
    [cadDoc, pcbSet],
  );

  const activeTarget = sceneTargets.find((t) => t.id === (hoveredId ?? selectedId)) ?? null;
  const highlightKey = activeTarget?.componentId ?? null;

  const bomCents = (components.data ?? []).reduce(
    (sum, c) => sum + (c.unitCostCents ?? 0) * c.quantity,
    0,
  );

  if (loading) {
    return <DotMatrixLoader className="absolute inset-0" label="Loading assembly" />;
  }

  if (!viewport || !product) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <Boxes className="text-muted-foreground mx-auto size-8" strokeWidth={1.5} />
          <h2 className="mt-3 font-mono text-lg font-medium tracking-[-0.025em]">
            {viewportResult.error
              ? "Assembly needs its source files"
              : "Build your product assembly"}
          </h2>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {viewportResult.error ??
              "Open Workflow details above to update CAD from your boards and build the linked assembly. You can also open CAD to add manufacturing parts."}
          </p>
          <button
            type="button"
            className="bg-primary text-primary-foreground mt-4 rounded-none px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] uppercase"
            onClick={() => onOpenEditor?.({ editor: "model", label: "CAD" })}
          >
            Open CAD
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex">
      <aside
        className="bg-card z-10 flex w-56 shrink-0 flex-col border-r lg:w-72"
        aria-label="Assembly components"
      >
        <div className="flex items-start gap-2 px-4 pt-3.5 pb-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[13px] font-medium">
              {preview?.mode === "part" ? product.name : "Product assembly"}
            </p>
            <p
              className="text-muted-foreground mt-1 truncate font-mono text-[11px]"
              title={product.path}
            >
              {product.path}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void syncFromServer()}
            disabled={syncing}
            aria-label={syncing ? "Syncing assembly" : "Reload assembly"}
            title="Reload assembly from saved project"
            className="text-muted-foreground hover:bg-muted hover:text-foreground -mr-1 flex size-7 shrink-0 items-center justify-center rounded-none disabled:opacity-60"
          >
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
          </button>
        </div>
        <div className="text-muted-foreground flex items-center justify-between border-t px-4 pt-3 pb-1 font-mono text-[10px] tracking-[0.1em] uppercase">
          <span>Components</span>
          <span className="font-mono tabular-nums">{sceneTargets.length}</span>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {sceneTargets.map((t) => {
            const hot =
              t.id === hoveredId ||
              t.id === selectedId ||
              (highlightKey !== null && t.componentId === highlightKey);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  title={t.detail}
                  aria-pressed={t.id === selectedId}
                  onMouseEnter={() => setHoveredId(t.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => setSelectedId(t.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 border-l-2 py-2.5 pr-4 pl-3.5 text-left transition-colors",
                    hot
                      ? "border-l-primary bg-primary/8 text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 border-l-transparent",
                  )}
                >
                  {t.kind === "pcb" ? (
                    <CircuitBoard className="size-3.5 shrink-0" strokeWidth={1.75} />
                  ) : (
                    <Boxes className="size-3.5 shrink-0" strokeWidth={1.75} />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{t.name}</span>
                  <span className="text-muted-foreground font-mono text-[9px]">
                    {t.kind === "pcb" ? "PCB" : "PART"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {activeTarget ? (
          <div className="shrink-0 border-t px-3 py-3">
            <p className="truncate font-mono text-xs font-medium">{activeTarget.name}</p>
            <p
              className="text-muted-foreground mt-1 truncate font-mono text-[10px]"
              title={activeTarget.detail}
            >
              {activeTarget.detail}
            </p>
            <div className="mt-2.5 flex gap-1.5">
              <button
                type="button"
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex flex-1 items-center justify-center gap-1.5 rounded-none px-2 py-1.5 font-mono text-[10px] tracking-[0.06em] uppercase"
                onClick={() => onOpenEditor?.(activeTarget.open)}
              >
                Open {activeTarget.kind === "pcb" ? "PCB" : "part"}
                <ArrowUpRight className="size-3" />
              </button>
              {activeTarget.kind === "pcb" ? (
                <button
                  type="button"
                  className="hover:bg-muted flex items-center gap-1 rounded-none border px-2 py-1.5 font-mono text-[10px] tracking-[0.06em] uppercase"
                  title="Open schematic"
                  aria-label="Open schematic"
                  onClick={() => onOpenEditor?.("schematic")}
                >
                  <Waypoints className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground shrink-0 border-t px-3 py-3 text-[11px] leading-relaxed">
            Select a component to open its editor.
          </p>
        )}
        <div className="text-muted-foreground flex h-9 shrink-0 items-center gap-2 border-t px-3 font-mono text-[10px] tracking-[0.06em] uppercase">
          <Package className="size-3" />
          <span>BOM estimate</span>
          <span className="text-foreground ml-auto font-mono tabular-nums">
            {formatCents(bomCents)}
          </span>
        </div>
      </aside>
      <div className="relative min-w-0 flex-1">
        {preview?.mode === "part" ? (
          <div
            className="bg-card text-muted-foreground pointer-events-none absolute top-3 left-3 z-20 rounded-none border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.04em]"
            role="status"
          >
            Part preview · assembly not built
          </div>
        ) : null}
        {viewport.engine === "zoo" && !viewport.foreignImportOnly ? (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
            <div className="max-w-xs">
              <Boxes className="text-muted-foreground mx-auto size-7" strokeWidth={1.5} />
              <p className="mt-3 font-mono text-sm font-medium tracking-[-0.02em]">
                Convert the assembly to Python
              </p>
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                {LEGACY_CAD_PREVIEW_MESSAGE}
              </p>
              <button
                type="button"
                onClick={() =>
                  onOpenEditor?.({ editor: "model", componentId: product.id, label: product.name })
                }
                className="hover:bg-muted mt-4 rounded-none border px-3 py-2 font-mono text-[10px] tracking-[0.08em] uppercase"
              >
                Open preserved source
              </button>
            </div>
          </div>
        ) : (
          <CadViewport
            engine={viewport.engine}
            key={viewportEpoch}
            modelKey={product?.id}
            script={viewport.script}
            projectId={projectId}
            projectFiles={viewport.projectFiles}
            entryPath={viewport.entryPath}
            meshAssets={viewport.meshAssets}
            foreignImportOnly={viewport.foreignImportOnly}
            selectedKey={highlightKey}
            selectionHints={activeTarget ? [activeTarget.name, activeTarget.id] : []}
            pickOnClick
            chrome
            headless={false}
            onError={setError}
            onSelectObject={(key) => {
              if (!key) {
                setSelectedId(null);
                return;
              }
              const needle = key.toLowerCase();
              const match =
                sceneTargets.find(
                  (target) => target.kind === "pcb" && target.componentId === key,
                ) ??
                sceneTargets.find((target) => target.componentId === key) ??
                sceneTargets.find((target) => target.name.toLowerCase() === needle) ??
                sceneTargets.find((target) => needle.includes(target.name.toLowerCase()));
              setSelectedId(match?.id ?? key);
            }}
          />
        )}
        {error ? (
          <div
            className="text-destructive bg-background/95 absolute inset-x-0 top-0 z-10 border-b px-3 py-2 text-xs"
            role="alert"
          >
            Assembly error: {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
