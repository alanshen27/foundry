"use client";

/**
 * Engineer home — renders the product PREVIEW (`assembly/product.kcl`).
 *
 * Manufacturing geometry lives under parts/. add_part_to_assembly regenerates
 * this preview from those files as Zoo references (named solids preferred).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Boxes, CircuitBoard, Package, RefreshCw, Waypoints } from "lucide-react";
import { DotMatrixLoader } from "@/components/dot-matrix-loader";
import { CadViewport } from "@/components/engineer/cad-viewport";
import { normalizeCadDoc, type CadComponent } from "@/lib/cad/engine";
import { cadViewportInput } from "@/lib/cad/viewport-project";
import { normalizePcbDoc } from "@/lib/pcb/doc";
import { formatCents } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export type AssemblyOpenTarget =
  "pcb" | "schematic" | { editor: "model"; componentId?: string; label?: string };

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
  open: AssemblyOpenTarget;
};

/** Prefer `assembly/product.kcl`, else the first assembly component. */
function pickProductAssembly(doc: ReturnType<typeof normalizeCadDoc>): CadComponent | null {
  const assemblies = doc.components.filter((c) => c.kind === "assembly" && c.content.trim());
  return (
    assemblies.find(
      (c) =>
        c.path === "assembly/product.kcl" ||
        c.path === "assembly/product/main.kcl" ||
        c.name === "product",
    ) ??
    assemblies[0] ??
    null
  );
}

function sceneTargetsFromDoc(
  cadDoc: ReturnType<typeof normalizeCadDoc>,
  pcbDoc: ReturnType<typeof normalizePcbDoc> | null,
): SceneTarget[] {
  const parts = cadDoc.components.filter((c) => c.kind === "part" && c.content.trim());
  const out: SceneTarget[] = parts.map((c) => ({
    id: c.id,
    name: c.name,
    kind: "mechanical" as const,
    detail: c.path,
    open: { editor: "model" as const, componentId: c.id, label: c.name },
  }));
  if (pcbDoc) {
    out.push({
      id: "pcb",
      name: "PCB",
      kind: "pcb",
      detail: `${pcbDoc.board.widthMm} × ${pcbDoc.board.heightMm} mm · ${pcbDoc.footprints.length} placements`,
      open: "pcb",
    });
  }
  return out;
}

export function AssemblyView({ projectId, branchId, onOpenEditor }: Props) {
  const utils = trpc.useUtils();
  const model = trpc.design.get.useQuery({ projectId, branchId, kind: "MODEL3D" });
  const pcb = trpc.design.get.useQuery({ projectId, branchId, kind: "PCB" });
  const engine = trpc.cad.engineSession.useQuery({ projectId });
  const components = trpc.engineer.listComponents.useQuery({ projectId, branchId });
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewportEpoch, setViewportEpoch] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const loading = (model.isLoading || pcb.isLoading || engine.isLoading) && !syncing;

  const syncFromServer = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await Promise.all([
        utils.design.get.invalidate({ projectId, branchId, kind: "MODEL3D" }),
        utils.design.get.invalidate({ projectId, branchId, kind: "PCB" }),
        utils.cad.engineSession.invalidate({ projectId }),
        utils.engineer.listComponents.invalidate({ projectId, branchId }),
      ]);
      await Promise.all([
        utils.design.get.refetch({ projectId, branchId, kind: "MODEL3D" }),
        utils.design.get.refetch({ projectId, branchId, kind: "PCB" }),
        utils.cad.engineSession.refetch({ projectId }),
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
  const pcbDoc = useMemo(
    () => (pcb.data?.data ? normalizePcbDoc(pcb.data.data) : null),
    [pcb.data],
  );

  const product = useMemo(() => (cadDoc ? pickProductAssembly(cadDoc) : null), [cadDoc]);

  const viewport = useMemo(
    () => (cadDoc && product ? cadViewportInput(cadDoc, product.id) : null),
    [cadDoc, product],
  );

  useEffect(() => {
    if (!product || !viewport) {
      console.warn("[Assembly] no assembly/product.kcl to render");
      return;
    }
    console.groupCollapsed(`[Assembly] product assembly · ${product.path}`);
    console.log(viewport.script);
    if (viewport.projectFiles) {
      console.log("project files", Object.keys(viewport.projectFiles).sort());
    }
    console.groupEnd();
  }, [product, viewport]);

  const sceneTargets = useMemo(
    () => (cadDoc ? sceneTargetsFromDoc(cadDoc, pcbDoc) : []),
    [cadDoc, pcbDoc],
  );

  const activeTarget = sceneTargets.find((t) => t.id === (hoveredId ?? selectedId)) ?? null;

  const bomCents = (components.data ?? []).reduce(
    (sum, c) => sum + (c.unitCostCents ?? 0) * c.quantity,
    0,
  );

  if (loading) {
    return <DotMatrixLoader className="absolute inset-0" label="Loading assembly" />;
  }

  if (!engine.data?.token) {
    return (
      <div className="text-destructive flex h-full items-center justify-center p-8 text-sm">
        ZOO_API_TOKEN is not configured on the server.
      </div>
    );
  }

  if (!viewport || !product) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <Boxes className="text-muted-foreground mx-auto size-8" strokeWidth={1.5} />
          <h2 className="mt-3 text-lg font-semibold">No product preview</h2>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Assembly shows <span className="font-mono text-[12px]">assembly/product.kcl</span> — the
            visual product preview. Manufacturing geometry stays under{" "}
            <span className="font-mono text-[12px]">parts/</span>. Ask the copilot to build the
            preview, or open CAD and edit that file.
          </p>
          <button
            type="button"
            className="bg-primary text-primary-foreground mt-4 rounded-none px-3 py-1.5 text-xs font-medium"
            onClick={() => onOpenEditor?.({ editor: "model", label: "CAD" })}
          >
            Open CAD
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <CadViewport
        key={viewportEpoch}
        script={viewport.script}
        engine={{ token: engine.data.token, baseUrl: engine.data.baseUrl }}
        projectFiles={viewport.projectFiles}
        entryPath={viewport.entryPath}
        meshAssets={viewport.meshAssets}
        foreignImportOnly={viewport.foreignImportOnly}
        chrome
        headless={false}
        onError={setError}
      />
      {error ? (
        <div className="text-destructive bg-background/90 absolute inset-x-0 top-0 z-10 p-3 font-mono text-xs">
          Assembly error: {error}
        </div>
      ) : null}

      <div className="absolute top-3 right-3 z-10 flex w-72 flex-col gap-2">
        <button
          type="button"
          onClick={() => void syncFromServer()}
          disabled={syncing}
          className="bg-card/95 hover:bg-card flex items-center justify-center gap-2 rounded-none border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur-md disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Reload · sync from server"}
        </button>

        <div className="bg-card/90 overflow-hidden rounded-none border shadow-lg backdrop-blur-md">
          <div className="border-b px-3 py-2">
            <p className="text-xs font-semibold">Product assembly</p>
            <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">{product.path}</p>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              Poses live in this file — open a part to edit geometry
            </p>
          </div>
          <ul className="flex max-h-[min(60vh,420px)] flex-col gap-0.5 overflow-y-auto p-1.5">
            {sceneTargets.map((t) => {
              const hot = t.id === hoveredId || t.id === selectedId;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setHoveredId(t.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => setSelectedId(t.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-none px-2.5 py-2 text-left transition-all duration-150",
                      hot
                        ? "bg-primary/15 -translate-y-0.5 shadow-sm ring-1 ring-primary/30"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-none",
                        t.kind === "pcb"
                          ? "bg-phase-engineer/15 text-phase-engineer"
                          : "bg-primary/10 text-primary",
                      )}
                    >
                      {t.kind === "pcb" ? (
                        <CircuitBoard className="size-3.5" strokeWidth={1.75} />
                      ) : (
                        <Boxes className="size-3.5" strokeWidth={1.75} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{t.name}</span>
                      <span className="text-muted-foreground block truncate text-[11px]">
                        {t.detail}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {activeTarget ? (
          <div className="bg-card/95 animate-in fade-in slide-in-from-top-1 rounded-none border px-3 py-2.5 shadow-lg backdrop-blur-md duration-150">
            <div className="flex items-start gap-2">
              <span className="bg-primary/15 text-primary mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-none">
                <ArrowUpRight className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{activeTarget.name}</p>
                <p className="text-muted-foreground text-[11px]">
                  {activeTarget.kind === "pcb" ? "Open in PCB editor" : "Open in CAD editor"}
                </p>
              </div>
            </div>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                className="bg-primary text-primary-foreground flex flex-1 items-center justify-center gap-1 rounded-none px-2 py-1.5 text-[11px] font-medium"
                onClick={() => onOpenEditor?.(activeTarget.open)}
              >
                Open
                <ArrowUpRight className="size-3" />
              </button>
              {activeTarget.kind === "pcb" ? (
                <button
                  type="button"
                  className="bg-muted flex items-center gap-1 rounded-none px-2 py-1.5 text-[11px] font-medium"
                  onClick={() => onOpenEditor?.("schematic")}
                >
                  <Waypoints className="size-3" />
                  Schematic
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="bg-card/80 text-muted-foreground flex items-center gap-2 rounded-none border px-2.5 py-1.5 text-[11px] shadow backdrop-blur-md">
          <Package className="size-3" />
          BOM · est. {formatCents(bomCents)}
        </div>
      </div>
    </div>
  );
}
