"use client";

/**
 * PCB layout workspace (Engineer > PCB): board outline, stackup dimensions,
 * footprint placement, two-layer copper routing, DRC, and Gerber output.
 *
 * The document is the single source of truth for geometry; connectivity and
 * rule violations are derived from it on every render (see lib/pcb/routing.ts
 * and lib/pcb/drc.ts) rather than cached, so dragging a footprint immediately
 * re-answers "is this still connected?" without any invalidation bookkeeping.
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
  pcbCursorSurface,
  type CursorState,
  type LiveLock,
  type LiveMove,
} from "@foundry/realtime";
import {
  AlertTriangle,
  Box,
  CircleDot,
  Download,
  FlipHorizontal2,
  Layers,
  Layers3,
  LayoutGrid,
  MessageSquare,
  MousePointer2,
  PanelRight,
  Plus,
  Redo2,
  RotateCw,
  Search,
  ShieldCheck,
  Spline,
  Square,
  Ruler,
  Trash2,
  Undo2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DotMatrixLoader } from "@/components/dot-matrix-loader";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createBoard,
  createFootprint,
  emptyPcbDoc,
  emptyPcbSet,
  footprintDef,
  normalizePcbDoc,
  normalizePcbSet,
  pcbId,
  searchFootprints,
  type PcbBoard,
  type PcbDoc,
  type PcbFootprint,
  type PcbLayer,
  type PcbPoint,
  type PcbSide,
  type PcbTrack,
  type PcbZone,
} from "@/lib/pcb/doc";
import { EMPTY_CIRCUIT, normalizeCircuitDoc } from "@/lib/circuit/catalog";
import { circuitForGroup, partitionBoards } from "@/lib/circuit/groups";
import { buildRatsnest, netsByPad, padNetMap } from "@/lib/pcb/netlist";
import {
  buildCopperGraph,
  padAt,
  route45Points,
  trackAt,
  trackLength,
  viaAt,
  zoneAt,
} from "@/lib/pcb/routing";
import { runDrc } from "@/lib/pcb/drc";
import { fabricationFiles } from "@/lib/pcb/export";
import { trpc } from "@/lib/trpc";
import { useCursors } from "@/lib/use-cursors";
import { useLiveEdit } from "@/lib/use-live-edit";
import { ViewportComments, type CommentPoint } from "@/components/engineer/viewport-comments";

const PcbPreview3d = dynamic(
  () => import("@/components/engineer/pcb-preview-3d").then((m) => m.PcbPreview3d),
  {
    ssr: false,
    loading: () => <DotMatrixLoader className="absolute inset-0" label="Loading 3D" />,
  },
);

const PX_PER_MM = 8;
const PAD = 24;

/** How near a pad a click must land to snap onto it, in board millimetres. */
const SNAP_MM = 0.5;
/** Pick radius for selecting existing copper. */
const PICK_MM = 0.4;
/** Undo depth. Deep enough for a routing session, bounded so state stays small. */
const HISTORY_LIMIT = 60;

type Tool = "select" | "route" | "via" | "zone" | "measure" | "comment";
type InspectorTab = "board" | "rules" | "drc" | "inspect";

type LayerKey = "Edge.Cuts" | "F.Cu" | "B.Cu" | "F.SilkS" | "courtyard" | "ratsnest";

const COPPER_COLOR: Record<PcbLayer, string> = { "F.Cu": "#c04040", "B.Cu": "#4040c0" };

/**
 * Collaborators' pointers are stored in board millimetres, then projected into
 * this client's current pan/zoom. The glyph remains screen-sized while its tip
 * stays anchored to the same copper, pad, or footprint for every collaborator.
 */
function PcbCursorLayer({
  peers,
  scale,
  pan,
}: {
  peers: CursorState[];
  scale: number;
  pan: { x: number; y: number };
}) {
  return (
    <g pointerEvents="none" aria-hidden="true">
      {peers.map((peer) => {
        const labelWidth = Math.max(42, peer.name.length * 6 + 12);
        return (
          <g
            key={peer.userId}
            transform={`translate(${pan.x + peer.x * scale} ${pan.y + peer.y * scale})`}
          >
            <path
              d="M2 2 L2 14 L5.5 10.8 L7.8 15.6 L10.2 14.5 L7.9 9.8 L12.4 9.6 Z"
              fill={peer.color}
              stroke="#0b0b0b"
              strokeWidth={1}
              strokeLinejoin="round"
            />
            <rect
              x={12}
              y={16}
              width={labelWidth}
              height={18}
              rx={5}
              fill={peer.color}
              stroke="#0b0b0b"
              strokeWidth={0.5}
            />
            <text x={18} y={29} fill="#0b0b0b" fontSize={10} fontWeight={600}>
              {peer.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Projects `to` onto the nearest 45-degree ray from `from` — the routing
 * convention every PCB tool uses, because acute copper corners etch unevenly.
 * Holding shift bypasses this for the occasional odd angle.
 */
function snapTo45(from: PcbPoint, to: PcbPoint): PcbPoint {
  const dx = to.xMm - from.xMm;
  const dy = to.yMm - from.yMm;
  if (dx === 0 && dy === 0) return to;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Length along the chosen ray, never behind the start point.
  const len = Math.max(0, dx * cos + dy * sin);
  return { xMm: from.xMm + cos * len, yMm: from.yMm + sin * len };
}

/** Round to a 0.05 mm grid so hand-drawn copper lands on tidy coordinates. */
function quantize(p: PcbPoint): PcbPoint {
  return { xMm: Math.round(p.xMm * 20) / 20, yMm: Math.round(p.yMm * 20) / 20 };
}

function trackPath(points: PcbPoint[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.xMm} ${p.yMm}`).join(" ");
}

const polygonPoints = (points: PcbPoint[]) => points.map((p) => `${p.xMm},${p.yMm}`).join(" ");

/**
 * Pour rendering mirrors the Gerber writer: fill the outline, then knock out
 * foreign-net copper through an SVG mask rather than computing a polygon
 * difference. White in the mask keeps copper, black removes it.
 */
function ZoneFill({
  zone,
  doc,
  padNetFor,
  dimmed,
}: {
  zone: PcbZone;
  doc: PcbDoc;
  padNetFor: (footprintId: string, pin: string) => string | undefined;
  dimmed: boolean;
}) {
  const clearance = zone.clearanceMm ?? doc.rules.clearanceMm;
  const maskId = `zone-mask-${zone.id}`;

  return (
    <>
      <mask id={maskId} maskUnits="userSpaceOnUse">
        <polygon points={polygonPoints(zone.points)} fill="white" />
        {doc.tracks
          .filter((t) => t.layer === zone.layer && !(zone.net && t.net === zone.net))
          .map((t) => (
            <path
              key={t.id}
              d={trackPath(t.points)}
              fill="none"
              stroke="black"
              strokeWidth={t.widthMm + clearance * 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        {doc.vias
          .filter((v) => !(zone.net && v.net === zone.net))
          .map((v) => (
            <circle
              key={v.id}
              cx={v.xMm}
              cy={v.yMm}
              r={v.diameterMm / 2 + clearance}
              fill="black"
            />
          ))}
        {doc.footprints.flatMap((fp) => {
          const def = footprintDef(fp.libraryId);
          if (!def) return [];
          const onLayer = (pad: { plated?: boolean }) =>
            pad.plated || (fp.side === "front" ? "F.Cu" : "B.Cu") === zone.layer;
          return def.pads
            .filter((pad) => onLayer(pad) && !(zone.net && padNetFor(fp.id, pad.pin) === zone.net))
            .map((pad, i) => (
              <rect
                key={`${fp.id}-${i}`}
                x={pad.xMm - pad.wMm / 2 - clearance}
                y={pad.yMm - pad.hMm / 2 - clearance}
                width={pad.wMm + clearance * 2}
                height={pad.hMm + clearance * 2}
                rx={pad.shape === "oval" ? Math.min(pad.wMm, pad.hMm) / 2 + clearance : 0}
                fill="black"
                transform={`translate(${fp.xMm} ${fp.yMm}) rotate(${fp.rotationDeg})`}
              />
            ));
        })}
      </mask>
      <polygon
        points={polygonPoints(zone.points)}
        fill={COPPER_COLOR[zone.layer]}
        opacity={dimmed ? 0.18 : 0.32}
        mask={`url(#${maskId})`}
      />
      <polygon
        points={polygonPoints(zone.points)}
        fill="none"
        stroke={COPPER_COLOR[zone.layer]}
        strokeWidth={0.1}
        strokeDasharray="0.6 0.4"
        opacity={0.7}
      />
    </>
  );
}

/** Browser download of the generated fabrication set, one file at a time. */
function downloadFiles(files: { name: string; contents: string }[]) {
  for (const file of files) {
    const blob = new Blob([file.contents], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

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
  lock,
  liveMove,
}: {
  fp: PcbFootprint;
  selected: boolean;
  layers: Record<LayerKey, boolean>;
  canEdit: boolean;
  onPointerDown: (e: ReactPointerEvent<SVGGElement>, id: string) => void;
  /** Peer currently holding this footprint; renders it untouchable. */
  lock?: LiveLock;
  /** Peer's in-progress drag; drawn instead of the persisted position. */
  liveMove?: LiveMove;
}) {
  const def = footprintDef(fp.libraryId);
  if (!def) return null;
  const copperOn =
    (fp.side === "front" && layers["F.Cu"]) || (fp.side === "back" && layers["B.Cu"]);
  const silkOn = layers["F.SilkS"] && fp.side === "front";
  const copper = fp.side === "front" ? "#c04040" : "#4040c0";
  const xMm = liveMove?.x ?? fp.xMm;
  const yMm = liveMove?.y ?? fp.yMm;
  const rotation = liveMove?.rotation ?? fp.rotationDeg;
  const holder = lock ?? liveMove;

  return (
    <g
      transform={`translate(${xMm} ${yMm}) rotate(${rotation})`}
      onPointerDown={(e) => onPointerDown(e, fp.id)}
      style={{ cursor: holder ? "not-allowed" : canEdit ? "grab" : "default" }}
      opacity={fp.side === "back" ? 0.85 : 1}
    >
      {holder ? (
        <g pointerEvents="none">
          <rect
            x={-def.bodyWMm / 2 - 0.4}
            y={-def.bodyHMm / 2 - 0.4}
            width={def.bodyWMm + 0.8}
            height={def.bodyHMm + 0.8}
            fill="none"
            stroke={holder.color}
            strokeWidth={0.15}
            strokeDasharray="0.5 0.3"
          />
          <text
            x={-def.bodyWMm / 2 - 0.4}
            y={-def.bodyHMm / 2 - 0.8}
            fontSize={1.1}
            fill={holder.color}
            style={{ userSelect: "none" }}
          >
            {holder.name}
          </text>
        </g>
      ) : null}
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
  const viewer = trpc.project.viewer.useQuery();
  const save = trpc.design.save.useMutation();

  /** Every board in the project; `doc` below is the one being edited. */
  const [boards, setBoards] = useState<PcbDoc[]>(() => emptyPcbSet().boards);
  const [activeBoardId, setActiveBoardId] = useState<string>("board-1");
  const doc = useMemo(
    () => boards.find((b) => b.id === activeBoardId) ?? boards[0] ?? emptyPcbDoc(),
    [boards, activeBoardId],
  );
  /** Edits target the active board and write the whole set back. */
  const setDoc = useCallback(
    (update: PcbDoc | ((d: PcbDoc) => PcbDoc)) => {
      setBoards((bs) =>
        bs.map((b) => {
          if (b.id !== activeBoardId) return b;
          const next = typeof update === "function" ? update(b) : update;
          // The id and binding are set by the switcher, never by an edit.
          return { ...next, id: b.id, name: b.name, groupId: b.groupId };
        }),
      );
    },
    [activeBoardId],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [footprintCategory, setFootprintCategory] = useState("All");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("inspect");
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: PAD, y: PAD });
  const [tool, setTool] = useState<Tool>("select");
  const [activeLayer, setActiveLayer] = useState<PcbLayer>("F.Cu");
  /** The track being drawn: committed vertices, plus a live segment to the cursor. */
  const [draft, setDraft] = useState<{ layer: PcbLayer; net?: string; points: PcbPoint[] } | null>(
    null,
  );
  const [cursorMm, setCursorMm] = useState<PcbPoint | null>(null);
  const [freeAngle, setFreeAngle] = useState(false);
  const [showDrc, setShowDrc] = useState(false);
  /** Outline being drawn with the zone tool. */
  const [zoneDraft, setZoneDraft] = useState<PcbPoint[] | null>(null);
  /** Net to pour into new zones, and the net highlighted on the canvas. */
  const [activeNet, setActiveNet] = useState<string | null>(null);
  const [measurement, setMeasurement] = useState<{
    from: PcbPoint;
    to: PcbPoint;
    complete: boolean;
  } | null>(null);
  /** Where a new comment is being composed, in board millimetres. */
  const [pendingComment, setPendingComment] = useState<CommentPoint | null>(null);
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
  const boardsRef = useRef(boards);
  boardsRef.current = boards;
  const activeBoardIdRef = useRef(activeBoardId);
  activeBoardIdRef.current = activeBoardId;
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
  // Mirrors of the in-progress drafts. Committing a track or pour is a side
  // effect, and React re-invokes state updaters in development to surface
  // impure ones — doing the commit inside `setDraft` duplicated every piece of
  // copper. Updaters stay pure; the commit reads the draft from here instead.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const zoneDraftRef = useRef(zoneDraft);
  zoneDraftRef.current = zoneDraft;
  // Undo stacks hold whole documents. A board is small enough that snapshotting
  // is cheaper to reason about than a command log, and it makes every mutation
  // (drag, route, delete, board resize) undoable through one code path.
  const undoRef = useRef<PcbDoc[]>([]);
  const redoRef = useRef<PcbDoc[]>([]);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });

  const syncHistoryDepth = useCallback(() => {
    setHistoryDepth({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, []);

  const lastPushRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });

  /**
   * Snapshot the current document before mutating it.
   *
   * `key` coalesces bursts: typing in a width field or nudging a coordinate
   * fires per keystroke, and one undo step per character would bury the edit
   * the user actually wants to reverse. Repeats of the same key inside the
   * window fold into the first snapshot.
   */
  const pushHistory = useCallback(
    (key = "") => {
      const now = Date.now();
      const last = lastPushRef.current;
      if (key && last.key === key && now - last.at < 600) {
        lastPushRef.current = { key, at: now };
        return;
      }
      lastPushRef.current = { key, at: now };
      undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), docRef.current];
      redoRef.current = [];
      syncHistoryDepth();
    },
    [syncHistoryDepth],
  );

  const scheduleSave = useCallback(() => {
    if (!canEdit) return;
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveRef.current.mutate(
        {
          projectId,
          branchId,
          kind: "PCB",
          data: {
            version: 2,
            boards: boardsRef.current,
            activeBoardId: activeBoardIdRef.current,
          },
        },
        {
          onSuccess: () => {
            dirtyRef.current = false;
            liveRef.current.commit();
          },
        },
      );
    }, 800);
  }, [canEdit, projectId, branchId]);

  useEffect(() => {
    if (dirtyRef.current) return;
    const set = query.data ? normalizePcbSet(query.data.data) : emptyPcbSet();
    setBoards(set.boards);
    setActiveBoardId((current) =>
      set.boards.some((b) => b.id === current)
        ? current
        : (set.activeBoardId ?? set.boards[0]!.id!),
    );
  }, [query.data]);

  const undo = useCallback(() => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current = [docRef.current, ...redoRef.current].slice(0, HISTORY_LIMIT);
    setDoc(previous);
    setDraft(null);
    syncHistoryDepth();
    scheduleSave();
  }, [scheduleSave, syncHistoryDepth]);

  const redo = useCallback(() => {
    const [next, ...rest] = redoRef.current;
    if (!next) return;
    redoRef.current = rest;
    undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), docRef.current];
    setDoc(next);
    setDraft(null);
    syncHistoryDepth();
    scheduleSave();
  }, [scheduleSave, syncHistoryDepth]);

  const patchBoard = useCallback(
    (patch: Partial<PcbBoard>) => {
      pushHistory(`board:${Object.keys(patch).join(",")}`);
      setDoc((d) => normalizePcbDoc({ ...d, board: { ...d.board, ...patch } }));
      scheduleSave();
    },
    [pushHistory, scheduleSave],
  );

  const patchRules = useCallback(
    (patch: Partial<PcbDoc["rules"]>) => {
      pushHistory(`rules:${Object.keys(patch).join(",")}`);
      setDoc((d) => normalizePcbDoc({ ...d, rules: { ...d.rules, ...patch } }));
      scheduleSave();
    },
    [pushHistory, scheduleSave],
  );

  const patchSelected = useCallback(
    (patch: Partial<PcbFootprint>) => {
      if (!selectedId) return;
      pushHistory(`fp:${selectedId}:${Object.keys(patch).join(",")}`);
      setDoc((d) => ({
        ...d,
        footprints: d.footprints.map((f) => (f.id === selectedId ? { ...f, ...patch } : f)),
      }));
      scheduleSave();
    },
    [selectedId, pushHistory, scheduleSave],
  );

  const addFootprint = useCallback(
    (libraryId: string) => {
      const current = docRef.current;
      const fp = createFootprint(libraryId, current.footprints, {
        xMm: Math.round(current.board.widthMm / 2),
        yMm: Math.round(current.board.heightMm / 2),
      });
      if (!fp) return;
      pushHistory();
      setDoc((d) => ({ ...d, footprints: [...d.footprints, fp] }));
      setSelectedId(fp.id);
      scheduleSave();
    },
    [pushHistory, scheduleSave],
  );

  const arrangeFootprints = useCallback(() => {
    if (docRef.current.footprints.length === 0) return;
    pushHistory();
    setDoc((current) => {
      const columns = Math.max(1, Math.ceil(Math.sqrt(current.footprints.length)));
      const rows = Math.ceil(current.footprints.length / columns);
      const cellW = Math.max(8, (current.board.widthMm - 8) / columns);
      const cellH = Math.max(8, (current.board.heightMm - 8) / rows);
      return {
        ...current,
        footprints: current.footprints.map((footprint, index) => ({
          ...footprint,
          xMm: Math.round((4 + ((index % columns) + 0.5) * cellW) * 20) / 20,
          yMm: Math.round((4 + (Math.floor(index / columns) + 0.5) * cellH) * 20) / 20,
        })),
      };
    });
    scheduleSave();
  }, [pushHistory, scheduleSave]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    pushHistory();
    setDoc((d) => ({ ...d, footprints: d.footprints.filter((f) => f.id !== selectedId) }));
    setSelectedId(null);
    scheduleSave();
  }, [selectedId, pushHistory, scheduleSave]);

  const deleteSelectedTrack = useCallback(() => {
    if (!selectedTrackId) return;
    pushHistory();
    setDoc((d) => ({
      ...d,
      tracks: d.tracks.filter((t) => t.id !== selectedTrackId),
      vias: d.vias.filter((v) => v.id !== selectedTrackId),
    }));
    setSelectedTrackId(null);
    scheduleSave();
  }, [selectedTrackId, pushHistory, scheduleSave]);

  const scale = PX_PER_MM * zoom;
  const cursors = useCursors(
    projectId,
    branchId,
    viewMode === "2d" ? pcbCursorSurface(activeBoardId) : `pcb-3d:${activeBoardId}`,
    {
      userId: viewer.data?.id ?? "anonymous",
      name: viewer.data?.name ?? "Someone",
    },
  );
  const reportCursor = cursors.report;

  const live = useLiveEdit(
    projectId,
    branchId,
    pcbCursorSurface(activeBoardId),
    {
      userId: viewer.data?.id ?? "anonymous",
      name: viewer.data?.name ?? "Someone",
    },
    // A peer's save landed; pick it up unless local edits are still unsaved.
    () => {
      if (!dirtyRef.current) void query.refetch();
    },
  );
  const liveRef = useRef(live);
  liveRef.current = live;

  const fullCircuit = useMemo(
    () => (circuitQuery.data ? normalizeCircuitDoc(circuitQuery.data.data) : EMPTY_CIRCUIT),
    [circuitQuery.data],
  );
  const partition = useMemo(() => partitionBoards(fullCircuit), [fullCircuit]);
  /**
   * Nets are derived from only this board's slice of the schematic. Without
   * that, a part on a sibling board reads as "unplaced" here and the ratsnest
   * demands a trace to copper that lives on another PCB entirely.
   */
  const circuit = useMemo(
    () => circuitForGroup(fullCircuit, doc.groupId ?? null),
    [fullCircuit, doc.groupId],
  );
  const boardSlice = partition.slices.find((s) => s.group.id === doc.groupId) ?? null;

  const addBoard = useCallback(
    (groupId?: string, label?: string) => {
      const made = createBoard(boardsRef.current, groupId, label);
      setBoards((bs) => [...bs, made]);
      setActiveBoardId(made.id!);
      dirtyRef.current = true;
      scheduleSave();
    },
    [scheduleSave],
  );

  const patchBoardMeta = useCallback(
    (patch: Partial<Pick<PcbDoc, "name" | "groupId">>) => {
      setBoards((bs) =>
        bs.map((b) => (b.id === activeBoardIdRef.current ? { ...b, ...patch } : b)),
      );
      scheduleSave();
    },
    [scheduleSave],
  );

  const deleteBoard = useCallback(() => {
    const remaining = boardsRef.current.filter((b) => b.id !== activeBoardIdRef.current);
    // A project always has at least one board to edit.
    if (remaining.length === 0) return;
    setBoards(remaining);
    setActiveBoardId(remaining[0]!.id!);
    scheduleSave();
  }, [scheduleSave]);
  // Zones pour around a named net, so the graph needs the schematic's pad->net
  // mapping before it can decide what a pour connects.
  const padNetKeys = useMemo(() => padNetMap(circuit, doc), [circuit, doc]);
  // One copper graph per document version, shared by the ratsnest and DRC so
  // the two always agree about what is connected.
  const copper = useMemo(() => buildCopperGraph(doc, padNetKeys), [doc, padNetKeys]);
  // Recomputed while dragging so airwires track the footprint under the cursor.
  const ratsnest = useMemo(() => buildRatsnest(circuit, doc, copper), [circuit, doc, copper]);
  const padNets = useMemo(() => netsByPad(ratsnest.nets, doc), [ratsnest.nets, doc]);
  const drc = useMemo(() => runDrc(doc, ratsnest, copper), [doc, ratsnest, copper]);
  const pads = copper.pads;

  const onWheel = useCallback((e: ReactWheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(4, Math.max(0.25, z * (e.deltaY > 0 ? 0.9 : 1.1))));
  }, []);

  /** Screen coordinates -> board millimetres. */
  const clientToMm = useCallback(
    (clientX: number, clientY: number): PcbPoint | null => {
      const el = svgRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        xMm: (clientX - rect.left - pan.x) / scale,
        yMm: (clientY - rect.top - pan.y) / scale,
      };
    },
    [pan.x, pan.y, scale],
  );

  /**
   * Where a routing click actually lands: a pad centre when one is in range,
   * otherwise the 45-degree-constrained, grid-quantised cursor. Snapping to the
   * pad centre (not the click point) is what makes the copper graph register a
   * connection instead of stopping a hair short of the pad.
   */
  const routePoint = useCallback(
    (mm: PcbPoint, from: PcbPoint | null): { point: PcbPoint; net?: string; onPad: boolean } => {
      const pad = padAt(pads, mm.xMm, mm.yMm, activeLayer, SNAP_MM);
      if (pad) {
        return {
          point: { xMm: pad.xMm, yMm: pad.yMm },
          net: padNets.get(`${pad.footprintId}:${pad.pin}`),
          onPad: true,
        };
      }
      const constrained = from && !freeAngle ? snapTo45(from, mm) : mm;
      return { point: quantize(constrained), onPad: false };
    },
    [pads, activeLayer, padNets, freeAngle],
  );

  const commitTrack = useCallback(
    (points: PcbPoint[], layer: PcbLayer, net?: string) => {
      if (points.length < 2) return;
      pushHistory();
      const track: PcbTrack = {
        id: pcbId("tr"),
        layer,
        widthMm: docRef.current.rules.trackWidthMm,
        net,
        points,
      };
      setDoc((d) => ({ ...d, tracks: [...d.tracks, track] }));
      scheduleSave();
    },
    [pushHistory, scheduleSave],
  );

  /**
   * Route one remaining airwire with a reviewable 45° candidate. The normal
   * DRC immediately evaluates clearance and shorts, so this remains an assist
   * rather than pretending to be an obstacle-aware autorouter.
   */
  const guideNextAirwire = useCallback(() => {
    const airwire =
      (activeNet ? ratsnest.airwires.find((candidate) => candidate.net === activeNet) : null) ??
      ratsnest.airwires[0];
    if (!airwire) return;
    const points = route45Points(
      { xMm: airwire.from.xMm, yMm: airwire.from.yMm },
      { xMm: airwire.to.xMm, yMm: airwire.to.yMm },
    );
    commitTrack(points, activeLayer, airwire.net);
    setActiveNet(airwire.net);
    setShowDrc(true);
  }, [activeLayer, activeNet, commitTrack, ratsnest.airwires]);

  /** Place a via, and when routing, use it to continue on the opposite layer. */
  const placeVia = useCallback(
    (at: PcbPoint, net?: string) => {
      pushHistory();
      const { viaDiameterMm, viaDrillMm } = docRef.current.rules;
      setDoc((d) => ({
        ...d,
        vias: [
          ...d.vias,
          {
            id: pcbId("via"),
            xMm: at.xMm,
            yMm: at.yMm,
            diameterMm: viaDiameterMm,
            drillMm: viaDrillMm,
            net,
          },
        ],
      }));
      scheduleSave();
    },
    [pushHistory, scheduleSave],
  );

  const commitZone = useCallback(
    (points: PcbPoint[], layer: PcbLayer, net: string | null) => {
      if (points.length < 3) return;
      pushHistory();
      const zone: PcbZone = { id: pcbId("zone"), layer, net: net ?? undefined, points };
      setDoc((d) => ({ ...d, zones: [...d.zones, zone] }));
      scheduleSave();
    },
    [pushHistory, scheduleSave],
  );

  /** Close the zone outline being drawn. */
  const finishZone = useCallback(() => {
    const points = zoneDraftRef.current;
    setZoneDraft(null);
    if (points && points.length >= 3) commitZone(points, activeLayer, activeNet);
  }, [commitZone, activeLayer, activeNet]);

  const deleteSelectedZone = useCallback(() => {
    if (!selectedTrackId) return;
    pushHistory();
    setDoc((d) => ({ ...d, zones: d.zones.filter((z) => z.id !== selectedTrackId) }));
    setSelectedTrackId(null);
    scheduleSave();
  }, [selectedTrackId, pushHistory, scheduleSave]);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setZoneDraft(null);
  }, []);

  /** Finish the current track at its last committed vertex. */
  const finishDraft = useCallback(() => {
    const current = draftRef.current;
    setDraft(null);
    if (current && current.points.length >= 2) {
      commitTrack(current.points, current.layer, current.net);
    }
  }, [commitTrack]);

  /**
   * Drop a via at the routing head and continue on the other layer: commits the
   * copper drawn so far, then restarts a draft from the same point so the two
   * runs meet at the via.
   */
  const viaAndSwitchLayer = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    const head = current.points[current.points.length - 1];
    if (!head) return;
    const next: PcbLayer = current.layer === "F.Cu" ? "B.Cu" : "F.Cu";
    setDraft({ layer: next, net: current.net, points: [head] });
    setActiveLayer(next);
    if (current.points.length >= 2) commitTrack(current.points, current.layer, current.net);
    placeVia(head, current.net);
  }, [commitTrack, placeVia]);

  const onFootprintPointerDown = useCallback(
    (e: ReactPointerEvent<SVGGElement>, id: string) => {
      // While routing, a click on a footprint is a click on its pad — let the
      // SVG handler snap to it rather than starting a drag.
      if (tool !== "select") return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setSelectedId(id);
      setSelectedTrackId(null);
      setInspectorTab("inspect");
      if (!canEdit) return;
      // Someone else is holding this footprint — show, don't grab.
      if (liveRef.current.lockHolder(id)) return;
      const fp = docRef.current.footprints.find((f) => f.id === id);
      if (!fp) return;
      liveRef.current.acquire(id);
      pushHistory();
      dragRef.current = {
        id,
        originX: fp.xMm,
        originY: fp.yMm,
        startClientX: e.clientX,
        startClientY: e.clientY,
      };
    },
    [canEdit, tool, pushHistory],
  );

  const onSvgPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      // Right-click ends the current run, the way every PCB editor behaves.
      if (e.button === 2 && (draft || zoneDraft)) {
        e.preventDefault();
        if (draft) finishDraft();
        else finishZone();
        return;
      }
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
      if (e.button !== 0) return;

      const mm = clientToMm(e.clientX, e.clientY);
      if (!mm) return;

      if (tool === "comment") {
        setPendingComment({ x: mm.xMm, y: mm.yMm });
        return;
      }

      if (tool === "measure") {
        const point = quantize(mm);
        setMeasurement((current) =>
          !current || current.complete
            ? { from: point, to: point, complete: false }
            : { from: current.from, to: point, complete: true },
        );
        return;
      }

      if (tool === "route" && canEdit) {
        const head = draft?.points[draft.points.length - 1] ?? null;
        const { point, net, onPad } = routePoint(mm, head);
        if (!draft) {
          setDraft({ layer: activeLayer, net, points: [point] });
          return;
        }
        const points = [...draft.points, point];
        // Landing on a pad completes the connection, so end the run there.
        if (onPad) {
          commitTrack(points, draft.layer, draft.net ?? net);
          setDraft(null);
        } else {
          setDraft({ ...draft, points });
        }
        return;
      }

      if (tool === "zone" && canEdit) {
        const point = quantize(mm);
        // Clicking near the first vertex closes the outline.
        const first = zoneDraft?.[0];
        if (
          first &&
          zoneDraft!.length >= 3 &&
          Math.hypot(first.xMm - point.xMm, first.yMm - point.yMm) < 1
        ) {
          finishZone();
          return;
        }
        setZoneDraft((points) => [...(points ?? []), point]);
        return;
      }

      if (tool === "via" && canEdit) {
        const pad = padAt(pads, mm.xMm, mm.yMm, activeLayer, SNAP_MM);
        const at = pad ? { xMm: pad.xMm, yMm: pad.yMm } : quantize(mm);
        placeVia(at, pad ? padNets.get(`${pad.footprintId}:${pad.pin}`) : undefined);
        return;
      }

      // Select tool: prefer the smallest thing under the cursor. A pad click
      // also latches its net, which is what drives the highlight.
      const pad = padAt(pads, mm.xMm, mm.yMm, activeLayer, SNAP_MM);
      if (pad) {
        setActiveNet(padNets.get(`${pad.footprintId}:${pad.pin}`) ?? null);
      }
      const via = viaAt(doc.vias, mm.xMm, mm.yMm, PICK_MM);
      const track = via ? null : trackAt(doc.tracks, mm.xMm, mm.yMm, activeLayer, PICK_MM);
      const zone = via || track ? null : zoneAt(doc.zones, mm.xMm, mm.yMm, activeLayer);
      if (via || track || zone) {
        setSelectedTrackId(via?.id ?? track?.id ?? zone!.id);
        setSelectedId(null);
        setInspectorTab("inspect");
        return;
      }
      setSelectedId(null);
      setSelectedTrackId(null);
    },
    [
      pan.x,
      pan.y,
      draft,
      zoneDraft,
      tool,
      canEdit,
      activeLayer,
      clientToMm,
      routePoint,
      commitTrack,
      finishDraft,
      finishZone,
      placeVia,
      padNets,
      pads,
      doc.tracks,
      doc.vias,
      doc.zones,
    ],
  );

  const onSvgPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const pointerMm = clientToMm(e.clientX, e.clientY);
      if (pointerMm) reportCursor(pointerMm.xMm, pointerMm.yMm);

      if (panDragRef.current) {
        const d = panDragRef.current;
        setPan({
          x: d.originPanX + (e.clientX - d.startX),
          y: d.originPanY + (e.clientY - d.startY),
        });
        return;
      }
      // The routing preview needs the cursor even when nothing is being dragged.
      if (tool !== "select") {
        const mm = pointerMm;
        if (mm) {
          // A pour outline is not angle-constrained, so it only snaps to grid.
          if (tool === "zone" || tool === "measure") setCursorMm(quantize(mm));
          else setCursorMm(routePoint(mm, draft?.points[draft.points.length - 1] ?? null).point);
          if (tool === "measure") {
            setMeasurement((current) =>
              current && !current.complete ? { ...current, to: quantize(mm) } : current,
            );
          }
        }
      }
      const drag = dragRef.current;
      if (!drag || !canEdit) return;
      const dx = (e.clientX - drag.startClientX) / scale;
      const dy = (e.clientY - drag.startClientY) / scale;
      const nextX = Math.round((drag.originX + dx) * 20) / 20;
      const nextY = Math.round((drag.originY + dy) * 20) / 20;
      liveRef.current.reportMove(drag.id, nextX, nextY);
      setDoc((d) => ({
        ...d,
        footprints: d.footprints.map((f) =>
          f.id === drag.id ? { ...f, xMm: nextX, yMm: nextY } : f,
        ),
      }));
    },
    [canEdit, scale, tool, draft, clientToMm, routePoint, reportCursor],
  );

  const onSvgPointerUp = useCallback(() => {
    if (dragRef.current) {
      liveRef.current.release(dragRef.current.id);
      dragRef.current = null;
      scheduleSave();
    }
    panDragRef.current = null;
  }, [scheduleSave]);

  const footprintCategories = useMemo(
    () => ["All", ...new Set(searchFootprints("").map((entry) => entry.category))],
    [],
  );
  const results = useMemo(
    () =>
      searchFootprints(search).filter(
        (entry) => footprintCategory === "All" || entry.category === footprintCategory,
      ),
    [search, footprintCategory],
  );
  const selected = doc.footprints.find((f) => f.id === selectedId) ?? null;
  const selectedDef = selected ? footprintDef(selected.libraryId) : null;
  const selectedPart = selected?.partId
    ? (circuit.parts.find((p) => p.id === selected.partId) ?? null)
    : null;
  const issueCount =
    ratsnest.issues.unlinkedParts.length +
    ratsnest.issues.unmappedPins.length +
    ratsnest.issues.danglingFootprints.length;
  const totalTrackLength = useMemo(
    () => doc.tracks.reduce((sum, track) => sum + trackLength(track.points), 0),
    [doc.tracks],
  );
  const netLengths = useMemo(() => {
    const lengths = new Map<string, number>();
    for (const track of doc.tracks) {
      const name = track.net ?? "Unassigned";
      lengths.set(name, (lengths.get(name) ?? 0) + trackLength(track.points));
    }
    return [...lengths.entries()].sort((a, b) => b[1] - a[1]);
  }, [doc.tracks]);
  const routingPercent =
    ratsnest.totalConnections === 0
      ? 100
      : Math.round((ratsnest.routedCount / ratsnest.totalConnections) * 100);

  /**
   * Editor keys. Bound on window rather than the SVG so they work without the
   * canvas holding focus, and skipped while a form field has focus so typing a
   * reference designator does not switch tools.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }

      if (e.key === "Shift") setFreeAngle(true);

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod) return;

      switch (e.key.toLowerCase()) {
        case "escape":
          if (draft || zoneDraft) cancelDraft();
          else if (measurement) setMeasurement(null);
          else {
            setSelectedId(null);
            setSelectedTrackId(null);
            setActiveNet(null);
          }
          break;
        case "enter":
          if (draft) finishDraft();
          else if (zoneDraft) finishZone();
          break;
        case "z":
          if (canEdit) setTool("zone");
          break;
        case "x":
          // Swap routing layer; mid-run this needs a via to stay connected.
          if (draft) viaAndSwitchLayer();
          else setActiveLayer((l) => (l === "F.Cu" ? "B.Cu" : "F.Cu"));
          break;
        case "v":
          if (draft) viaAndSwitchLayer();
          else if (canEdit) setTool("via");
          break;
        case "r":
          if (canEdit) setTool("route");
          break;
        case "m":
          setTool("measure");
          setMeasurement(null);
          break;
        case "s":
          setTool("select");
          setDraft(null);
          setZoneDraft(null);
          setMeasurement(null);
          break;
        case "delete":
        case "backspace":
          if (selectedTrackId) {
            // One selection id covers tracks, vias and zones.
            if (docRef.current.zones.some((z) => z.id === selectedTrackId)) deleteSelectedZone();
            else deleteSelectedTrack();
          } else if (selectedId) deleteSelected();
          break;
        default:
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setFreeAngle(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    draft,
    zoneDraft,
    measurement,
    canEdit,
    selectedId,
    selectedTrackId,
    undo,
    redo,
    cancelDraft,
    finishDraft,
    finishZone,
    viaAndSwitchLayer,
    deleteSelected,
    deleteSelectedTrack,
    deleteSelectedZone,
  ]);

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
    return <DotMatrixLoader className="absolute inset-0" label="Loading PCB" />;
  }

  const gridStep = zoom >= 1.5 ? 1 : zoom >= 0.75 ? 5 : 10;

  return (
    <div className="bg-background absolute inset-0 flex">
      {/* Library */}
      <aside className="bg-card/40 hidden w-64 shrink-0 flex-col border-r md:flex">
        <div className="border-b px-3 py-2">
          <div className="text-[10px] font-semibold tracking-wider uppercase">Footprints</div>
          <p className="text-muted-foreground mt-0.5 text-[10px]">
            Place packages, then route the schematic airwires.
          </p>
        </div>
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
        <label className="flex items-center gap-2 border-b px-2.5 py-1.5">
          <span className="text-muted-foreground text-[10px]">Category</span>
          <select
            value={footprintCategory}
            onChange={(event) => setFootprintCategory(event.target.value)}
            className="bg-background h-7 min-w-0 flex-1 rounded-md border px-1.5 text-[10px]"
            aria-label="Footprint category"
          >
            {footprintCategories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </label>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
          {results.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={!canEdit}
              onClick={() => addFootprint(entry.id)}
              className="hover:bg-muted/60 flex flex-col items-start rounded-none px-2 py-1.5 text-left transition-colors disabled:opacity-50"
            >
              <span className="text-xs font-medium">{entry.name}</span>
              <span className="text-muted-foreground text-[10px]">
                {entry.category} · {entry.bodyWMm}×{entry.bodyHMm} mm
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1 border-t p-2">
          <Button
            variant="outline"
            size="xs"
            disabled={!canEdit || doc.footprints.length === 0}
            onClick={arrangeFootprints}
          >
            <WandSparkles className="size-3" /> Arrange footprints
          </Button>
          <p className="text-muted-foreground text-[10px] leading-snug">
            R route · V via · Z pour · M measure · X swap layer · S select · Esc cancel
          </p>
        </div>
      </aside>

      {/* Canvas */}
      <div className="relative min-w-0 flex-1">
        <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1.5">
          {/* Board switcher. Present even with one board so it is discoverable. */}
          <div className="bg-card/90 flex items-center gap-1 rounded-none border px-1.5 py-0.5 shadow-lg backdrop-blur-md">
            <Layers3 className="text-muted-foreground size-3" />
            <select
              value={activeBoardId}
              onChange={(e) => setActiveBoardId(e.target.value)}
              className="max-w-40 bg-transparent text-[11px] outline-none"
              aria-label="Active board"
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name ?? b.id}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="xs"
              disabled={!canEdit}
              onClick={() => addBoard()}
              title="Add a board"
            >
              <Plus className="size-3" />
            </Button>
          </div>

          <div className="bg-card/90 flex items-center gap-0.5 rounded-none border p-0.5 shadow-lg backdrop-blur-md">
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

          {viewMode === "2d" ? (
            <>
              <div className="bg-card/90 flex items-center gap-0.5 rounded-none border p-0.5 shadow-lg backdrop-blur-md">
                <Button
                  variant={tool === "select" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => {
                    setTool("select");
                    setDraft(null);
                  }}
                  aria-pressed={tool === "select"}
                  title="Select (S)"
                >
                  <MousePointer2 className="size-3" />
                </Button>
                <Button
                  variant={tool === "route" ? "secondary" : "ghost"}
                  size="xs"
                  disabled={!canEdit}
                  onClick={() => setTool("route")}
                  aria-pressed={tool === "route"}
                  title="Route track (R)"
                >
                  <Spline className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={!canEdit || ratsnest.airwires.length === 0}
                  onClick={guideNextAirwire}
                  title="Guide next airwire — add a 45° candidate, then review DRC"
                >
                  <WandSparkles className="size-3" />
                  <span className="ml-1">Guide</span>
                </Button>
                <Button
                  variant={tool === "via" ? "secondary" : "ghost"}
                  size="xs"
                  disabled={!canEdit}
                  onClick={() => setTool("via")}
                  aria-pressed={tool === "via"}
                  title="Place via (V)"
                >
                  <CircleDot className="size-3" />
                </Button>
                <Button
                  variant={tool === "zone" ? "secondary" : "ghost"}
                  size="xs"
                  disabled={!canEdit}
                  onClick={() => setTool("zone")}
                  aria-pressed={tool === "zone"}
                  title="Copper pour (Z) — click to outline, click the first point to close"
                >
                  <LayoutGrid className="size-3" />
                </Button>
                <Button
                  variant={tool === "measure" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => {
                    setTool("measure");
                    setMeasurement(null);
                  }}
                  aria-pressed={tool === "measure"}
                  title="Measure between two points (M)"
                >
                  <Ruler className="size-3" />
                </Button>
                <Button
                  variant={tool === "comment" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => {
                    setTool("comment");
                    setPendingComment(null);
                  }}
                  aria-pressed={tool === "comment"}
                  title="Pin a comment to the board"
                >
                  <MessageSquare className="size-3" />
                </Button>
              </div>

              {/* Net picker: sets the pour's net and highlights it on the board. */}
              <div className="bg-card/90 flex items-center gap-1 rounded-none border px-1.5 py-0.5 shadow-lg backdrop-blur-md">
                <span className="text-muted-foreground text-[10px]">Net</span>
                <select
                  value={activeNet ?? ""}
                  onChange={(e) => setActiveNet(e.target.value || null)}
                  className="bg-transparent font-mono text-[11px] outline-none"
                  aria-label="Active net"
                >
                  <option value="">none</option>
                  {ratsnest.nets.map((n) => (
                    <option key={n.name} value={n.name}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-card/90 flex items-center gap-0.5 rounded-none border p-0.5 shadow-lg backdrop-blur-md">
                {(["F.Cu", "B.Cu"] as const).map((layer) => (
                  <Button
                    key={layer}
                    variant={activeLayer === layer ? "secondary" : "ghost"}
                    size="xs"
                    onClick={() => setActiveLayer(layer)}
                    aria-pressed={activeLayer === layer}
                    title={`Route on ${layer} (X to swap)`}
                  >
                    <span
                      className="mr-1 size-2 rounded-none"
                      style={{ background: COPPER_COLOR[layer] }}
                      aria-hidden
                    />
                    <span className="font-mono text-[10px]">{layer}</span>
                  </Button>
                ))}
              </div>

              <label className="bg-card/90 flex items-center gap-1 rounded-none border px-1.5 py-0.5 shadow-lg backdrop-blur-md">
                <span className="text-muted-foreground text-[10px]">Width</span>
                <select
                  value={doc.rules.trackWidthMm}
                  disabled={!canEdit}
                  onChange={(event) => patchRules({ trackWidthMm: Number(event.target.value) })}
                  className="bg-transparent font-mono text-[10px] outline-none"
                  aria-label="Active track width"
                >
                  {[0.15, 0.2, 0.25, 0.4, 0.6, 1].map((width) => (
                    <option key={width} value={width}>
                      {width} mm
                    </option>
                  ))}
                </select>
              </label>

              <div className="bg-card/90 flex items-center gap-0.5 rounded-none border p-0.5 shadow-lg backdrop-blur-md">
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={!canEdit || historyDepth.undo === 0}
                  onClick={undo}
                  title="Undo (Ctrl/Cmd+Z)"
                >
                  <Undo2 className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={!canEdit || historyDepth.redo === 0}
                  onClick={redo}
                  title="Redo (Ctrl/Cmd+Shift+Z)"
                >
                  <Redo2 className="size-3" />
                </Button>
              </div>

              <div className="bg-card/90 flex items-center gap-0.5 rounded-none border p-0.5 shadow-lg backdrop-blur-md">
                <Button
                  variant={showDrc ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => {
                    setShowDrc((value) => !value);
                    setInspectorTab("drc");
                  }}
                  aria-pressed={showDrc}
                  title="Toggle DRC markers"
                >
                  {drc.errorCount > 0 ? (
                    <AlertTriangle className="size-3 text-red-500" />
                  ) : (
                    <ShieldCheck className="size-3 text-emerald-500" />
                  )}
                  <span className="ml-1 tabular-nums">
                    {drc.errorCount}/{drc.warningCount}
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => downloadFiles(fabricationFiles(doc, "foundry-board", padNets))}
                  title="Download Gerber + drill files"
                >
                  <Download className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setInspectorTab("inspect")}
                  title="Open selection inspector"
                >
                  <PanelRight className="size-3" />
                </Button>
              </div>
            </>
          ) : null}
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
                        (wire.from.footprintId === selectedId ||
                          wire.to.footprintId === selectedId);
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

                {/* Pours sit beneath the tracks they are cleared around. */}
                {doc.zones.map((zone) =>
                  layers[zone.layer] ? (
                    <ZoneFill
                      key={zone.id}
                      zone={zone}
                      doc={doc}
                      padNetFor={(fpId, pin) => padNets.get(`${fpId}:${pin}`)}
                      dimmed={zone.layer !== activeLayer}
                    />
                  ) : null,
                )}

                {/* Copper sits under the footprints so pads stay readable. */}
                {doc.tracks.map((track) => {
                  if (!layers[track.layer]) return null;
                  const highlighted = activeNet !== null && track.net === activeNet;
                  const faded = activeNet !== null && !highlighted;
                  return (
                    <path
                      key={track.id}
                      d={trackPath(track.points)}
                      fill="none"
                      stroke={
                        track.id === selectedTrackId
                          ? "var(--color-primary)"
                          : COPPER_COLOR[track.layer]
                      }
                      strokeWidth={highlighted ? track.widthMm * 1.4 : track.widthMm}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={faded ? 0.25 : track.layer === activeLayer ? 1 : 0.55}
                    />
                  );
                })}

                {doc.vias.map((via) => (
                  <g key={via.id}>
                    <circle
                      cx={via.xMm}
                      cy={via.yMm}
                      r={via.diameterMm / 2}
                      fill={via.id === selectedTrackId ? "var(--color-primary)" : "#c8a020"}
                    />
                    {/* The drill shows through as the board colour. */}
                    <circle cx={via.xMm} cy={via.yMm} r={via.drillMm / 2} fill="#1a3d2e" />
                  </g>
                ))}

                {/* Live routing preview: committed vertices plus the rubber band. */}
                {draft ? (
                  <>
                    <path
                      d={trackPath(draft.points)}
                      fill="none"
                      stroke={COPPER_COLOR[draft.layer]}
                      strokeWidth={doc.rules.trackWidthMm}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.9}
                    />
                    {cursorMm ? (
                      <path
                        d={trackPath([draft.points[draft.points.length - 1]!, cursorMm])}
                        fill="none"
                        stroke={COPPER_COLOR[draft.layer]}
                        strokeWidth={doc.rules.trackWidthMm}
                        strokeLinecap="round"
                        strokeDasharray="0.5 0.3"
                        opacity={0.7}
                      />
                    ) : null}
                  </>
                ) : null}

                {doc.footprints.map((fp) => (
                  <FootprintGraphic
                    key={fp.id}
                    fp={fp}
                    selected={fp.id === selectedId}
                    layers={layers}
                    canEdit={canEdit}
                    onPointerDown={onFootprintPointerDown}
                    lock={live.lockHolder(fp.id)}
                    liveMove={live.moves.get(fp.id)}
                  />
                ))}

                {/* Zone outline being drawn, closing back to the first vertex. */}
                {zoneDraft && zoneDraft.length > 0 ? (
                  <polygon
                    points={polygonPoints(cursorMm ? [...zoneDraft, cursorMm] : zoneDraft)}
                    fill={COPPER_COLOR[activeLayer]}
                    fillOpacity={0.18}
                    stroke={COPPER_COLOR[activeLayer]}
                    strokeWidth={0.12}
                    strokeDasharray="0.5 0.3"
                  />
                ) : null}

                {measurement ? (
                  <g pointerEvents="none">
                    <line
                      x1={measurement.from.xMm}
                      y1={measurement.from.yMm}
                      x2={measurement.to.xMm}
                      y2={measurement.to.yMm}
                      stroke="var(--color-primary)"
                      strokeWidth={0.12}
                      strokeDasharray="0.5 0.25"
                    />
                    {[measurement.from, measurement.to].map((point, index) => (
                      <circle
                        key={index}
                        cx={point.xMm}
                        cy={point.yMm}
                        r={0.32}
                        fill="var(--color-background)"
                        stroke="var(--color-primary)"
                        strokeWidth={0.1}
                      />
                    ))}
                    <text
                      x={(measurement.from.xMm + measurement.to.xMm) / 2}
                      y={(measurement.from.yMm + measurement.to.yMm) / 2 - 0.8}
                      fill="var(--color-primary)"
                      fontSize={1.2}
                      textAnchor="middle"
                      paintOrder="stroke"
                      stroke="var(--color-background)"
                      strokeWidth={0.4}
                    >
                      {Math.hypot(
                        measurement.to.xMm - measurement.from.xMm,
                        measurement.to.yMm - measurement.from.yMm,
                      ).toFixed(2)}{" "}
                      mm
                    </text>
                  </g>
                ) : null}

                {/* Snap indicator, so it is obvious which pad a click will take. */}
                {tool !== "select" && cursorMm ? (
                  <circle
                    cx={cursorMm.xMm}
                    cy={cursorMm.yMm}
                    r={0.35}
                    fill="none"
                    stroke="var(--color-primary)"
                    strokeWidth={0.08}
                  />
                ) : null}

                {/* DRC markers, drawn last so they are never hidden by copper. */}
                {showDrc
                  ? drc.violations.map((v, i) =>
                      v.atMm ? (
                        <circle
                          key={i}
                          cx={v.atMm.xMm}
                          cy={v.atMm.yMm}
                          r={0.6}
                          fill="none"
                          stroke={v.severity === "error" ? "#f04040" : "#f0a020"}
                          strokeWidth={0.15}
                        />
                      ) : null,
                    )
                  : null}
              </g>
              <PcbCursorLayer peers={cursors.peers} scale={scale} pan={pan} />
            </svg>

            <ViewportComments
              projectId={projectId}
              branchId={branchId}
              surface={pcbCursorSurface(activeBoardId)}
              viewerId={viewer.data?.id ?? ""}
              toScreen={(point) => ({ x: pan.x + point.x * scale, y: pan.y + point.y * scale })}
              pending={pendingComment}
              onClearPending={() => setPendingComment(null)}
            />

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
              <span className="bg-card/85 text-muted-foreground rounded-none border px-2 py-1 text-[11px] tabular-nums backdrop-blur-md">
                {Math.round(zoom * 100)}% · {doc.board.widthMm}×{doc.board.heightMm} mm ·{" "}
                {doc.board.thicknessMm} mm
              </span>
            </div>

            <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
              <span className="bg-card/85 text-muted-foreground rounded-none border px-2.5 py-1 text-[11px] shadow backdrop-blur-md">
                {save.isPending
                  ? "Saving…"
                  : draft
                    ? `Routing on ${draft.layer} · click to add a corner · click a pad to finish · V for a via · Esc to cancel`
                    : zoneDraft
                      ? `Pour outline on ${activeLayer}${activeNet ? ` for ${activeNet}` : " (pick a net)"} · click the first point or press Enter to close`
                      : tool === "route"
                        ? `Click a pad to start routing on ${activeLayer}`
                        : tool === "via"
                          ? "Click to place a via"
                          : tool === "zone"
                            ? `Click to outline a pour on ${activeLayer}`
                            : tool === "measure"
                              ? measurement
                                ? `${Math.hypot(
                                    measurement.to.xMm - measurement.from.xMm,
                                    measurement.to.yMm - measurement.from.yMm,
                                  ).toFixed(2)} mm · click to finish or start another measurement`
                                : "Click the first measurement point"
                              : tool === "comment"
                                ? "Click anywhere to pin a comment"
                                : "Autosaves · drag to place · Alt-drag to pan · scroll to zoom"}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Inspector */}
      <aside className="bg-card/40 hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l p-3 md:flex">
        <div className="bg-card sticky top-0 z-10 -mx-3 -mt-3 grid grid-cols-4 border-b p-1">
          {(
            [
              ["board", "Board"],
              ["rules", "Rules"],
              ["drc", `DRC ${drc.errorCount}`],
              ["inspect", "Inspect"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              variant={inspectorTab === id ? "secondary" : "ghost"}
              size="xs"
              className="px-1"
              onClick={() => setInspectorTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>

        {inspectorTab === "board" ? (
          <>
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
                      className="size-2.5 rounded-none"
                      style={{ background: layer.color }}
                      aria-hidden
                    />
                    <span className="font-mono text-[11px]">{layer.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-xs font-semibold tracking-wide uppercase">Board</h2>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-16 shrink-0">Name</span>
                  <Input
                    value={doc.name ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => patchBoardMeta({ name: e.target.value })}
                    className="h-7 text-xs"
                    aria-label="Board name"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-16 shrink-0">Region</span>
                  <select
                    value={doc.groupId ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => patchBoardMeta({ groupId: e.target.value || undefined })}
                    className="bg-background h-7 flex-1 rounded-md border px-1.5 text-xs"
                    aria-label="Schematic region"
                  >
                    <option value="">whole schematic</option>
                    {fullCircuit.groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </label>
                {doc.groupId && !fullCircuit.groups.some((g) => g.id === doc.groupId) ? (
                  <p className="text-[10px] leading-snug text-amber-500">
                    This board points at a schematic region that no longer exists.
                  </p>
                ) : null}
                {boardSlice ? (
                  <p className="text-muted-foreground text-[10px] leading-snug">
                    {boardSlice.partIds.length} part
                    {boardSlice.partIds.length === 1 ? "" : "s"} in this region ·{" "}
                    {doc.footprints.filter((f) => f.partId).length} linked here
                  </p>
                ) : null}
                {boardSlice && boardSlice.crossingNets.length > 0 ? (
                  <p className="text-[10px] leading-snug text-amber-500">
                    Leaves this board: {boardSlice.crossingNets.join(", ")} — each needs a connector
                    footprint, and is excluded from this board&apos;s ratsnest.
                  </p>
                ) : null}
                {boards.length > 1 ? (
                  <Button
                    variant="destructive"
                    size="xs"
                    className="mt-0.5 self-start"
                    disabled={!canEdit}
                    onClick={deleteBoard}
                  >
                    <Trash2 className="size-3" /> Delete board
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        ) : null}

        {inspectorTab === "rules" ? (
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide uppercase">Design rules</h2>
            <div className="mb-3 grid grid-cols-3 gap-1">
              {[
                {
                  label: "Fine",
                  clearanceMm: 0.15,
                  trackWidthMm: 0.15,
                  viaDiameterMm: 0.5,
                  viaDrillMm: 0.25,
                },
                {
                  label: "Default",
                  clearanceMm: 0.2,
                  trackWidthMm: 0.25,
                  viaDiameterMm: 0.6,
                  viaDrillMm: 0.3,
                },
                {
                  label: "Power",
                  clearanceMm: 0.3,
                  trackWidthMm: 0.6,
                  viaDiameterMm: 0.9,
                  viaDrillMm: 0.45,
                },
              ].map((preset) => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="xs"
                  disabled={!canEdit}
                  onClick={() =>
                    patchRules({
                      clearanceMm: preset.clearanceMm,
                      trackWidthMm: preset.trackWidthMm,
                      viaDiameterMm: preset.viaDiameterMm,
                      viaDrillMm: preset.viaDrillMm,
                    })
                  }
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <BoardField
                label="Clearance"
                value={doc.rules.clearanceMm}
                unit="mm"
                step={0.05}
                disabled={!canEdit}
                onChange={(n) => patchRules({ clearanceMm: n })}
              />
              <BoardField
                label="Track width"
                value={doc.rules.trackWidthMm}
                unit="mm"
                step={0.05}
                disabled={!canEdit}
                onChange={(n) => patchRules({ trackWidthMm: n })}
              />
              <BoardField
                label="Via Ø"
                value={doc.rules.viaDiameterMm}
                unit="mm"
                step={0.05}
                disabled={!canEdit}
                onChange={(n) => patchRules({ viaDiameterMm: n })}
              />
              <BoardField
                label="Via drill"
                value={doc.rules.viaDrillMm}
                unit="mm"
                step={0.05}
                disabled={!canEdit}
                onChange={(n) => patchRules({ viaDrillMm: n })}
              />
            </div>
          </div>
        ) : null}

        {inspectorTab === "drc" ? (
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              {drc.errorCount > 0 ? (
                <AlertTriangle className="size-3.5 text-red-500" />
              ) : (
                <ShieldCheck className="size-3.5 text-emerald-500" />
              )}
              <h2 className="text-xs font-semibold tracking-wide uppercase">
                DRC · {drc.errorCount} error{drc.errorCount === 1 ? "" : "s"}
              </h2>
            </div>
            {drc.violations.length === 0 ? (
              <p className="text-muted-foreground text-[10px]">
                No rule violations. Board is routable as drawn.
              </p>
            ) : (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {drc.violations.slice(0, 40).map((v, i) => (
                  <li
                    key={i}
                    className={cn(
                      "rounded border-l-2 px-1.5 py-1 text-[10px] leading-snug",
                      v.severity === "error"
                        ? "border-l-red-500 bg-red-500/5"
                        : "border-l-amber-500 bg-amber-500/5",
                    )}
                  >
                    <span className="text-muted-foreground font-mono text-[9px]">{v.rule}</span>
                    <br />
                    {v.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {inspectorTab === "inspect" ? (
          <>
            <div>
              <h2 className="mb-2 text-xs font-semibold tracking-wide uppercase">Net lengths</h2>
              {netLengths.length === 0 ? (
                <p className="text-muted-foreground text-[10px]">
                  Route a net to see its copper length.
                </p>
              ) : (
                <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto">
                  {netLengths.map(([name, length]) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setActiveNet(name === "Unassigned" ? null : name)}
                      className={cn(
                        "flex items-center justify-between rounded-md px-1.5 py-1 font-mono text-[10px]",
                        activeNet === name ? "bg-primary/10 text-primary" : "hover:bg-muted/50",
                      )}
                    >
                      <span>{name}</span>
                      <span>{length.toFixed(2)} mm</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedTrackId
              ? (() => {
                  const track = doc.tracks.find((t) => t.id === selectedTrackId);
                  const zone = doc.zones.find((z) => z.id === selectedTrackId);
                  return (
                    <div>
                      <h2 className="mb-2 text-xs font-semibold tracking-wide uppercase">Copper</h2>
                      <p className="text-muted-foreground mb-1.5 text-[10px]">
                        {track
                          ? `Track on ${track.layer}${track.net ? ` · ${track.net}` : ""} · ${trackLength(track.points).toFixed(2)} mm`
                          : zone
                            ? `Pour on ${zone.layer} · ${zone.net ?? "no net"}`
                            : "Via"}
                      </p>
                      {track ? (
                        <BoardField
                          label="Width"
                          value={track.widthMm}
                          unit="mm"
                          step={0.05}
                          disabled={!canEdit}
                          onChange={(n) => {
                            pushHistory(`track:${track.id}:width`);
                            setDoc((d) => ({
                              ...d,
                              tracks: d.tracks.map((t) =>
                                t.id === track.id ? { ...t, widthMm: Math.max(0.05, n) } : t,
                              ),
                            }));
                            scheduleSave();
                          }}
                        />
                      ) : null}
                      <Button
                        variant="destructive"
                        size="xs"
                        className="mt-1.5"
                        disabled={!canEdit}
                        onClick={zone ? deleteSelectedZone : deleteSelectedTrack}
                      >
                        <Trash2 className="size-3" /> Delete
                      </Button>
                    </div>
                  );
                })()
              : null}

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
                              <span
                                className={net ? "text-foreground" : "text-muted-foreground/60"}
                              >
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
                        patchSelected({ rotationDeg: (selected.rotationDeg + 90) % 360 })
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
                Select a footprint or place one from the library. Origin is the top-left of
                Edge.Cuts.
              </p>
            )}
          </>
        ) : null}

        <p
          className={cn(
            "text-muted-foreground mt-auto rounded-none border px-2 py-1.5 text-[10px] leading-snug",
          )}
        >
          {doc.footprints.length} footprint{doc.footprints.length === 1 ? "" : "s"} · grid{" "}
          {gridStep} mm · {ratsnest.nets.length} net
          {ratsnest.nets.length === 1 ? "" : "s"} · {doc.tracks.length} track
          {doc.tracks.length === 1 ? "" : "s"} · {doc.vias.length} via
          {doc.vias.length === 1 ? "" : "s"} · {doc.zones.length} pour
          {doc.zones.length === 1 ? "" : "s"}
          <br />
          {ratsnest.routedCount}/{ratsnest.totalConnections} routed · {ratsnest.airwires.length}{" "}
          airwire
          {ratsnest.airwires.length === 1 ? "" : "s"} left · {routingPercent}% complete
          <br />
          {totalTrackLength.toFixed(2)} mm total copper length
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
