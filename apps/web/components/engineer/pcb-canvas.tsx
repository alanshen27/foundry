"use client";

/**
 * PCB layout workspace (Engineer > PCB): board outline, stackup dimensions,
 * and footprint placement on a millimetre grid. Routing / DRC / KiCad I/O are
 * later phases — this is the placement + outline baseline.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import dynamic from "next/dynamic";
import {
  Box,
  FlipHorizontal2,
  Layers,
  RotateCw,
  Search,
  Square,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  EMPTY_PCB,
  createFootprint,
  footprintDef,
  normalizePcbDoc,
  searchFootprints,
  type PcbBoard,
  type PcbDoc,
  type PcbFootprint,
  type PcbSide,
} from "@/lib/pcb/doc";
import { EMPTY_CIRCUIT, normalizeCircuitDoc } from "@/lib/circuit/catalog";
import { buildRatsnest, netsByPad } from "@/lib/pcb/netlist";
import { trpc } from "@/lib/trpc";

const PcbPreview3d = dynamic(
  () => import("@/components/engineer/pcb-preview-3d").then((m) => m.PcbPreview3d),
  {
    ssr: false,
    loading: () => <Skeleton className="absolute inset-0 rounded-none" />,
  },
);

const PX_PER_MM = 8;
const PAD = 24;

type LayerKey = "Edge.Cuts" | "F.Cu" | "B.Cu" | "F.SilkS" | "courtyard" | "ratsnest";

const LAYER_META: { id: LayerKey; label: string; color: string }[] = [
  { id: "Edge.Cuts", label: "Edge.Cuts", color: "#f0c040" },
  { id: "F.Cu", label: "F.Cu", color: "#c04040" },
  { id: "B.Cu", label: "B.Cu", color: "#4040c0" },
  { id: "F.SilkS", label: "F.SilkS", color: "#e8e8e0" },
  { id: "courtyard", label: "Courtyard", color: "#40c080" },
  { id: "ratsnest", label: "Ratsnest", color: "#d0d0d0" },
];

function BoardField({
  label,
  value,
  unit,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  step: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <Input
        type="number"
        value={value}
        disabled={disabled}
        step={step}
        min={0}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="h-7 flex-1 font-mono text-xs"
        aria-label={label}
      />
      <span className="text-muted-foreground w-6 text-[10px]">{unit}</span>
    </label>
  );
}

function FootprintGraphic({
  fp,
  selected,
  layers,
  canEdit,
  onPointerDown,
}: {
  fp: PcbFootprint;
  selected: boolean;
  layers: Record<LayerKey, boolean>;
  canEdit: boolean;
  onPointerDown: (e: ReactPointerEvent<SVGGElement>, id: string) => void;
}) {
  const def = footprintDef(fp.libraryId);
  if (!def) return null;
  const copperOn =
    (fp.side === "front" && layers["F.Cu"]) || (fp.side === "back" && layers["B.Cu"]);
  const silkOn = layers["F.SilkS"] && fp.side === "front";
  const copper = fp.side === "front" ? "#c04040" : "#4040c0";

  return (
    <g
      transform={`translate(${fp.xMm} ${fp.yMm}) rotate(${fp.rotationDeg})`}
      onPointerDown={(e) => onPointerDown(e, fp.id)}
      style={{ cursor: canEdit ? "grab" : "default" }}
      opacity={fp.side === "back" ? 0.85 : 1}
    >
      {layers.courtyard ? (
        <rect
          x={-def.bodyWMm / 2}
          y={-def.bodyHMm / 2}
          width={def.bodyWMm}
          height={def.bodyHMm}
          fill="none"
          stroke="#40c080"
          strokeWidth={0.08}
          strokeDasharray="0.3 0.2"
        />
      ) : null}
      {silkOn ? (
        <rect
          x={-def.bodyWMm / 2}
          y={-def.bodyHMm / 2}
          width={def.bodyWMm}
          height={def.bodyHMm}
          fill="rgb(232 232 224 / 0.15)"
          stroke="#e8e8e0"
          strokeWidth={0.1}
        />
      ) : null}
      {copperOn
        ? def.pads.map((pad, i) => (
            <rect
              key={i}
              x={pad.xMm - pad.wMm / 2}
              y={pad.yMm - pad.hMm / 2}
              width={pad.wMm}
              height={pad.hMm}
              rx={pad.shape === "oval" ? Math.min(pad.wMm, pad.hMm) / 2 : 0.05}
              fill={copper}
              stroke={selected ? "#fff" : "none"}
              strokeWidth={selected ? 0.08 : 0}
            />
          ))
        : null}
      {silkOn ? (
        <text
          x={0}
          y={-def.bodyHMm / 2 - 0.35}
          textAnchor="middle"
          fill="#e8e8e0"
          fontSize={0.7}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {fp.refDes}
        </text>
      ) : null}
      {selected ? (
        <rect
          x={-def.bodyWMm / 2 - 0.25}
          y={-def.bodyHMm / 2 - 0.25}
          width={def.bodyWMm + 0.5}
          height={def.bodyHMm + 0.5}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={0.12}
        />
      ) : null}
    </g>
  );
}

export function PcbCanvas({
  projectId,
  branchId,
  canEdit,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
}) {
  const query = trpc.design.get.useQuery({ projectId, branchId, kind: "PCB" });
  // The schematic is the source of nets; the board only references it.
  const circuitQuery = trpc.design.get.useQuery({ projectId, branchId, kind: "CIRCUIT" });
  const save = trpc.design.save.useMutation();

  const [doc, setDoc] = useState<PcbDoc>(EMPTY_PCB);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: PAD, y: PAD });
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    "Edge.Cuts": true,
    "F.Cu": true,
    "B.Cu": true,
    "F.SilkS": true,
    courtyard: true,
    ratsnest: true,
  });

  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const saveRef = useRef(save);
  saveRef.current = save;
  const dragRef = useRef<{
    id: string;
    originX: number;
    originY: number;
    startClientX: number;
    startClientY: number;
  } | null>(null);
  const panDragRef = useRef<{
    startX: number;
    startY: number;
    originPanX: number;
    originPanY: number;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fittedRef = useRef(false);

  const scheduleSave = useCallback(() => {
    if (!canEdit) return;
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveRef.current.mutate(
        { projectId, branchId, kind: "PCB", data: docRef.current },
        { onSuccess: () => (dirtyRef.current = false) },
      );
    }, 800);
  }, [canEdit, projectId, branchId]);

  useEffect(() => {
    if (dirtyRef.current) return;
    setDoc(query.data ? normalizePcbDoc(query.data.data) : { ...EMPTY_PCB, board: { ...EMPTY_PCB.board } });
  }, [query.data]);

  const patchBoard = useCallback(
    (patch: Partial<PcbBoard>) => {
      setDoc((d) => normalizePcbDoc({ ...d, board: { ...d.board, ...patch } }));
      scheduleSave();
    },
    [scheduleSave],
  );

  const patchSelected = useCallback(
    (patch: Partial<PcbFootprint>) => {
      if (!selectedId) return;
      setDoc((d) => ({
        ...d,
        footprints: d.footprints.map((f) => (f.id === selectedId ? { ...f, ...patch } : f)),
      }));
      scheduleSave();
    },
    [selectedId, scheduleSave],
  );

  const addFootprint = useCallback(
    (libraryId: string) => {
      setDoc((d) => {
        const fp = createFootprint(libraryId, d.footprints, {
          xMm: Math.round(d.board.widthMm / 2),
          yMm: Math.round(d.board.heightMm / 2),
        });
        if (!fp) return d;
        setSelectedId(fp.id);
        return { ...d, footprints: [...d.footprints, fp] };
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setDoc((d) => ({ ...d, footprints: d.footprints.filter((f) => f.id !== selectedId) }));
    setSelectedId(null);
    scheduleSave();
  }, [selectedId, scheduleSave]);

  const scale = PX_PER_MM * zoom;

  const onWheel = useCallback((e: ReactWheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(4, Math.max(0.25, z * (e.deltaY > 0 ? 0.9 : 1.1))));
  }, []);

  const onFootprintPointerDown = useCallback(
    (e: ReactPointerEvent<SVGGElement>, id: string) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setSelectedId(id);
      if (!canEdit) return;
      const fp = docRef.current.footprints.find((f) => f.id === id);
      if (!fp) return;
      dragRef.current = {
        id,
        originX: fp.xMm,
        originY: fp.yMm,
        startClientX: e.clientX,
        startClientY: e.clientY,
      };
    },
    [canEdit],
  );

  const onSvgPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (e.button === 1 || e.button === 2 || e.altKey) {
        e.preventDefault();
        panDragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          originPanX: pan.x,
          originPanY: pan.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      setSelectedId(null);
    },
    [pan.x, pan.y],
  );

  const onSvgPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (panDragRef.current) {
        const d = panDragRef.current;
        setPan({
          x: d.originPanX + (e.clientX - d.startX),
          y: d.originPanY + (e.clientY - d.startY),
        });
        return;
      }
      const drag = dragRef.current;
      if (!drag || !canEdit) return;
      const dx = (e.clientX - drag.startClientX) / scale;
      const dy = (e.clientY - drag.startClientY) / scale;
      setDoc((d) => ({
        ...d,
        footprints: d.footprints.map((f) =>
          f.id === drag.id
            ? {
                ...f,
                xMm: Math.round((drag.originX + dx) * 20) / 20,
                yMm: Math.round((drag.originY + dy) * 20) / 20,
              }
            : f,
        ),
      }));
    },
    [canEdit, scale],
  );

  const onSvgPointerUp = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null;
      scheduleSave();
    }
    panDragRef.current = null;
  }, [scheduleSave]);

  const results = useMemo(() => searchFootprints(search), [search]);
  const selected = doc.footprints.find((f) => f.id === selectedId) ?? null;

  const circuit = useMemo(
    () => (circuitQuery.data ? normalizeCircuitDoc(circuitQuery.data.data) : EMPTY_CIRCUIT),
    [circuitQuery.data],
  );
  // Recomputed while dragging so airwires track the footprint under the cursor.
  const ratsnest = useMemo(() => buildRatsnest(circuit, doc), [circuit, doc]);
  const padNets = useMemo(() => netsByPad(ratsnest.nets, doc), [ratsnest.nets, doc]);
  const selectedDef = selected ? footprintDef(selected.libraryId) : null;
  const selectedPart = selected?.partId
    ? (circuit.parts.find((p) => p.id === selected.partId) ?? null)
    : null;
  const issueCount =
    ratsnest.issues.unlinkedParts.length +
    ratsnest.issues.unmappedPins.length +
    ratsnest.issues.danglingFootprints.length;

  // Fit board once when the document first loads.
  useEffect(() => {
    if (!query.isSuccess || fittedRef.current) return;
    const el = svgRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (width < 40 || height < 40) return;
    const zx = (width - PAD * 2) / (doc.board.widthMm * PX_PER_MM);
    const zy = (height - PAD * 2) / (doc.board.heightMm * PX_PER_MM);
    const z = Math.min(2, Math.max(0.4, Math.min(zx, zy) * 0.9));
    setZoom(z);
    setPan({
      x: (width - doc.board.widthMm * PX_PER_MM * z) / 2,
      y: (height - doc.board.heightMm * PX_PER_MM * z) / 2,
    });
    fittedRef.current = true;
  }, [query.isSuccess, doc.board.widthMm, doc.board.heightMm]);

  if (query.isLoading) {
    return (
      <div className="absolute inset-0 flex">
        <Skeleton className="hidden w-64 rounded-none border-r md:block" />
        <Skeleton className="min-w-0 flex-1 rounded-none" />
        <Skeleton className="hidden w-60 rounded-none border-l md:block" />
      </div>
    );
  }

  const gridStep = zoom >= 1.5 ? 1 : zoom >= 0.75 ? 5 : 10;

  return (
    <div className="bg-background absolute inset-0 flex">
      {/* Library */}
      <aside className="bg-card/40 hidden w-64 shrink-0 flex-col border-r md:flex">
        <div className="flex items-center gap-1.5 border-b px-2.5 py-2">
          <Search className="text-muted-foreground size-3.5 shrink-0" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search footprints…"
            aria-label="Search footprints"
            className="h-7 border-none bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
            disabled={!canEdit}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
          {results.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={!canEdit}
              onClick={() => addFootprint(entry.id)}
              className="hover:bg-muted/60 flex flex-col items-start rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-50"
            >
              <span className="text-xs font-medium">{entry.name}</span>
              <span className="text-muted-foreground text-[10px]">
                {entry.category} · {entry.bodyWMm}×{entry.bodyHMm} mm
              </span>
            </button>
          ))}
        </div>
        <p className="text-muted-foreground border-t px-2.5 py-2 text-[10px] leading-snug">
          Placement &amp; outline baseline. Copper routing and DRC come later.
        </p>
      </aside>

      {/* Canvas */}
      <div className="relative min-w-0 flex-1">
        <div className="absolute top-3 left-3 z-10 flex items-center gap-0.5 rounded-lg border bg-card/90 p-0.5 shadow-lg backdrop-blur-md">
          <Button
            variant={viewMode === "2d" ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setViewMode("2d")}
            aria-pressed={viewMode === "2d"}
          >
            <Square className="size-3" /> 2D
          </Button>
          <Button
            variant={viewMode === "3d" ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setViewMode("3d")}
            aria-pressed={viewMode === "3d"}
          >
            <Box className="size-3" /> 3D
          </Button>
        </div>

        {viewMode === "3d" ? (
          <PcbPreview3d doc={doc} />
        ) : (
          <>
            <svg
              ref={svgRef}
              className="absolute inset-0 size-full touch-none"
              onWheel={onWheel}
              onPointerDown={onSvgPointerDown}
              onPointerMove={onSvgPointerMove}
              onPointerUp={onSvgPointerUp}
              onPointerLeave={onSvgPointerUp}
              onContextMenu={(e) => e.preventDefault()}
              role="img"
              aria-label="PCB board canvas"
            >
              <defs>
                <pattern
                  id="pcb-grid"
                  width={gridStep * scale}
                  height={gridStep * scale}
                  patternUnits="userSpaceOnUse"
                  x={pan.x}
                  y={pan.y}
                >
                  <path
                    d={`M ${gridStep * scale} 0 L 0 0 0 ${gridStep * scale}`}
                    fill="none"
                    stroke="var(--color-border)"
                    strokeWidth={1}
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="var(--color-background)" />
              <rect width="100%" height="100%" fill="url(#pcb-grid)" />

              <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
                <rect
                  width={doc.board.widthMm}
                  height={doc.board.heightMm}
                  rx={doc.board.cornerRadiusMm}
                  ry={doc.board.cornerRadiusMm}
                  fill="#1a3d2e"
                  stroke={layers["Edge.Cuts"] ? "#f0c040" : "none"}
                  strokeWidth={layers["Edge.Cuts"] ? 0.2 : 0}
                />
                <circle cx={0} cy={0} r={0.4} fill="#f0c040" opacity={0.7} />
                <text x={1} y={-1} fill="#f0c040" fontSize={1.1} opacity={0.7}>
                  (0,0)
                </text>

                {/* Airwires sit under the footprints so pads stay readable. */}
                {layers.ratsnest
                  ? ratsnest.airwires.map((wire, i) => {
                      const touchesSelection =
                        selectedId !== null &&
                        (wire.from.footprintId === selectedId || wire.to.footprintId === selectedId);
                      return (
                        <line
                          key={`${wire.net}-${i}`}
                          x1={wire.from.xMm}
                          y1={wire.from.yMm}
                          x2={wire.to.xMm}
                          y2={wire.to.yMm}
                          stroke={touchesSelection ? "var(--color-primary)" : "#d0d0d0"}
                          strokeWidth={touchesSelection ? 0.12 : 0.07}
                          strokeDasharray="0.4 0.3"
                          opacity={touchesSelection ? 0.95 : 0.5}
                        />
                      );
                    })
                  : null}

                {doc.footprints.map((fp) => (
                  <FootprintGraphic
                    key={fp.id}
                    fp={fp}
                    selected={fp.id === selectedId}
                    layers={layers}
                    canEdit={canEdit}
                    onPointerDown={onFootprintPointerDown}
                  />
                ))}
              </g>
            </svg>

            <div className="absolute bottom-3 left-3 flex items-center gap-1">
              <Button
                variant="outline"
                size="xs"
                onClick={() => setZoom((z) => Math.min(4, z * 1.2))}
              >
                <ZoomIn className="size-3" />
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={() => setZoom((z) => Math.max(0.25, z / 1.2))}
              >
                <ZoomOut className="size-3" />
              </Button>
              <span className="bg-card/85 text-muted-foreground rounded-md border px-2 py-1 text-[11px] tabular-nums backdrop-blur-md">
                {Math.round(zoom * 100)}% · {doc.board.widthMm}×{doc.board.heightMm} mm ·{" "}
                {doc.board.thicknessMm} mm
              </span>
            </div>

            <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
              <span className="bg-card/85 text-muted-foreground rounded-lg border px-2.5 py-1 text-[11px] shadow backdrop-blur-md">
                {save.isPending
                  ? "Saving…"
                  : "Autosaves · drag to place · Alt-drag to pan · scroll to zoom"}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Inspector */}
      <aside className="bg-card/40 hidden w-60 shrink-0 flex-col gap-3 overflow-y-auto border-l p-3 md:flex">
        <div>
          <h2 className="mb-2 text-xs font-semibold tracking-wide uppercase">Board</h2>
          <div className="flex flex-col gap-1.5">
            <BoardField
              label="Width"
              value={doc.board.widthMm}
              unit="mm"
              step={0.5}
              disabled={!canEdit}
              onChange={(n) => patchBoard({ widthMm: n })}
            />
            <BoardField
              label="Height"
              value={doc.board.heightMm}
              unit="mm"
              step={0.5}
              disabled={!canEdit}
              onChange={(n) => patchBoard({ heightMm: n })}
            />
            <BoardField
              label="Thickness"
              value={doc.board.thicknessMm}
              unit="mm"
              step={0.1}
              disabled={!canEdit}
              onChange={(n) => patchBoard({ thicknessMm: n })}
            />
            <BoardField
              label="Corner R"
              value={doc.board.cornerRadiusMm}
              unit="mm"
              step={0.25}
              disabled={!canEdit}
              onChange={(n) => patchBoard({ cornerRadiusMm: n })}
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <Layers className="text-muted-foreground size-3.5" />
            <h2 className="text-xs font-semibold tracking-wide uppercase">Layers</h2>
          </div>
          <div className="flex flex-col gap-1">
            {LAYER_META.map((layer) => (
              <label key={layer.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={layers[layer.id]}
                  onChange={(e) => setLayers((l) => ({ ...l, [layer.id]: e.target.checked }))}
                  className="accent-primary size-3.5"
                />
                <span
                  className="size-2.5 rounded-sm"
                  style={{ background: layer.color }}
                  aria-hidden
                />
                <span className="font-mono text-[11px]">{layer.label}</span>
              </label>
            ))}
          </div>
        </div>

        {selected ? (
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide uppercase">Footprint</h2>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-16 shrink-0">Ref</span>
                <Input
                  value={selected.refDes}
                  disabled={!canEdit}
                  onChange={(e) => patchSelected({ refDes: e.target.value })}
                  className="h-7 font-mono text-xs"
                  aria-label="Reference designator"
                />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-16 shrink-0">Value</span>
                <Input
                  value={selected.value ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => patchSelected({ value: e.target.value })}
                  className="h-7 font-mono text-xs"
                  aria-label="Footprint value"
                />
              </label>
              <BoardField
                label="X"
                value={selected.xMm}
                unit="mm"
                step={0.05}
                disabled={!canEdit}
                onChange={(n) => patchSelected({ xMm: n })}
              />
              <BoardField
                label="Y"
                value={selected.yMm}
                unit="mm"
                step={0.05}
                disabled={!canEdit}
                onChange={(n) => patchSelected({ yMm: n })}
              />
              <p className="text-muted-foreground text-[10px]">
                {selected.libraryId} · {selected.side}
              </p>

              <div className="mt-1 border-t pt-2">
                <h3 className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
                  Nets
                </h3>
                {selected.partId ? (
                  <p className="text-muted-foreground mb-1 text-[10px]">
                    Schematic part{" "}
                    <span className="text-foreground font-mono">
                      {selectedPart?.label ?? selectedPart?.id ?? selected.partId}
                    </span>
                    {selectedPart ? null : " (missing)"}
                  </p>
                ) : (
                  <p className="text-muted-foreground mb-1 text-[10px]">
                    Not linked to a schematic part — no nets.
                  </p>
                )}
                <div className="flex flex-col gap-0.5">
                  {(selectedDef?.pads ?? [])
                    .filter((pad) => pad.pin)
                    .map((pad) => {
                      const net = padNets.get(`${selected.id}:${pad.pin}`);
                      return (
                        <div
                          key={pad.pin}
                          className="flex items-center justify-between gap-2 font-mono text-[10px]"
                        >
                          <span className="text-muted-foreground">{pad.pin}</span>
                          <span className={net ? "text-foreground" : "text-muted-foreground/60"}>
                            {net ?? "—"}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!canEdit}
                  onClick={() =>
                    patchSelected({ rotationDeg: ((selected.rotationDeg + 90) % 360) })
                  }
                >
                  <RotateCw className="size-3" /> Rotate
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!canEdit}
                  onClick={() =>
                    patchSelected({
                      side: (selected.side === "front" ? "back" : "front") as PcbSide,
                    })
                  }
                >
                  <FlipHorizontal2 className="size-3" /> Flip
                </Button>
                <Button
                  variant="destructive"
                  size="xs"
                  disabled={!canEdit}
                  className="ml-auto"
                  onClick={deleteSelected}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            Select a footprint or place one from the library. Origin is the top-left of Edge.Cuts.
          </p>
        )}

        <p
          className={cn(
            "text-muted-foreground mt-auto rounded-md border px-2 py-1.5 text-[10px] leading-snug",
          )}
        >
          {doc.footprints.length} footprint{doc.footprints.length === 1 ? "" : "s"} · grid{" "}
          {gridStep} mm · {ratsnest.nets.length} net
          {ratsnest.nets.length === 1 ? "" : "s"} · {ratsnest.airwires.length} airwire
          {ratsnest.airwires.length === 1 ? "" : "s"}
          {issueCount > 0 ? (
            <>
              <br />
              {ratsnest.issues.unlinkedParts.length > 0
                ? `${ratsnest.issues.unlinkedParts.length} schematic part${ratsnest.issues.unlinkedParts.length === 1 ? "" : "s"} unplaced. `
                : null}
              {ratsnest.issues.unmappedPins.length > 0
                ? `${ratsnest.issues.unmappedPins.length} pin${ratsnest.issues.unmappedPins.length === 1 ? "" : "s"} unmapped. `
                : null}
              {ratsnest.issues.danglingFootprints.length > 0
                ? `${ratsnest.issues.danglingFootprints.length} stale link${ratsnest.issues.danglingFootprints.length === 1 ? "" : "s"}.`
                : null}
            </>
          ) : null}
        </p>
      </aside>
    </div>
  );
}
