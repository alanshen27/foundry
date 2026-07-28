"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  Code2,
  FileDown,
  Play,
  RotateCw,
  Search,
  Square,
  SquareDashed,
  Terminal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  EMPTY_CIRCUIT,
  catalogEntry,
  normalizeCircuitDoc,
  searchCatalog,
  wokwiDiagramToDoc,
  type CircuitDoc,
  type CircuitGroup,
  type CircuitPart,
  type WokwiDiagram,
} from "@/lib/circuit/catalog";
import { useTheme } from "@/components/theme-provider";
import {
  WIRE_STYLE,
  circuitNodeTypes,
  docToGraph,
  type PartNode,
} from "@/components/engineer/circuit-nodes";
import { partitionBoards, type BoardPartition } from "@/lib/circuit/groups";
import { Simulator } from "@/lib/sim/engine";
import { MCU_TYPES, partModel } from "@/lib/sim/parts";
import { runSketch, type SketchHandle } from "@/lib/sim/sketch";
import { useCursors } from "@/lib/use-cursors";
import type { CursorState } from "@foundry/realtime";
import { trpc } from "@/lib/trpc";

let seq = 1;
function uid(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${seq++}`;
}

/** Distinct border colours so adjacent board regions stay tellable apart. */
const GROUP_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#22d3ee"];

/**
 * Board regions, drawn in flow coordinates behind the parts. Rendered through
 * ViewportPortal rather than as nodes so they never take part in selection,
 * dragging or connection hit-testing — a region is a boundary, not a component.
 */
function GroupLayer({
  groups,
  partition,
  activeId,
  onSelect,
}: {
  groups: CircuitGroup[];
  partition: BoardPartition;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ViewportPortal>
      {groups.map((g, i) => {
        const color = g.color ?? GROUP_COLORS[i % GROUP_COLORS.length]!;
        const slice = partition.slices.find((s) => s.group.id === g.id);
        const active = g.id === activeId;
        return (
          <div
            key={g.id}
            onClick={() => onSelect(g.id)}
            style={{
              position: "absolute",
              transform: `translate(${g.x}px, ${g.y}px)`,
              width: g.w,
              height: g.h,
              border: `2px ${active ? "solid" : "dashed"} ${color}`,
              borderRadius: 12,
              background: `${color}0f`,
              // Parts must stay clickable, so only the label chip takes clicks.
              pointerEvents: "none",
              zIndex: 0,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -11,
                left: 10,
                pointerEvents: "all",
                cursor: "pointer",
                background: color,
                color: "#0b0b0b",
                fontSize: 11,
                fontWeight: 600,
                padding: "1px 8px",
                borderRadius: 6,
                whiteSpace: "nowrap",
              }}
            >
              {g.label}
              {slice ? ` · ${slice.partIds.length} parts` : ""}
              {slice && slice.crossingNets.length > 0 ? ` · ${slice.crossingNets.length}↔` : ""}
            </div>
          </div>
        );
      })}
    </ViewportPortal>
  );
}

/**
 * Collaborators' pointers, drawn in flow coordinates so they sit over the same
 * part for everyone regardless of how each person has panned or zoomed —
 * sharing screen coordinates would put a peer's cursor somewhere meaningless.
 */
function CursorLayer({ peers }: { peers: CursorState[] }) {
  return (
    <ViewportPortal>
      {peers.map((peer) => (
        <div
          key={peer.userId}
          style={{
            position: "absolute",
            transform: `translate(${peer.x}px, ${peer.y}px)`,
            pointerEvents: "none",
            zIndex: 1000,
            // No transition: a moving cursor is already smoothed by the send
            // rate, and easing would make it lag behind the person's real one.
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: "block" }}>
            <path
              d="M2 2 L2 14 L5.5 10.8 L7.8 15.6 L10.2 14.5 L7.9 9.8 L12.4 9.6 Z"
              fill={peer.color}
              stroke="#0b0b0b"
              strokeWidth={1}
              strokeLinejoin="round"
            />
          </svg>
          <span
            style={{
              position: "absolute",
              top: 16,
              left: 12,
              background: peer.color,
              color: "#0b0b0b",
              fontSize: 10,
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: 5,
              whiteSpace: "nowrap",
            }}
          >
            {peer.name}
          </span>
        </div>
      ))}
    </ViewportPortal>
  );
}

const DEFAULT_SKETCH = `// Simulated, not compiled firmware: JavaScript with the Arduino API's shape.
// delay() must be yielded, which is what keeps the virtual clock deterministic.

function setup() {
  pinMode(13, OUTPUT);
}

function* loop() {
  digitalWrite(13, HIGH);
  yield delay(500);
  digitalWrite(13, LOW);
  yield delay(500);
}
`;

function graphToDoc(
  nodes: PartNode[],
  edges: Edge[],
  groups: CircuitGroup[] = [],
  sketchFileId?: string,
): CircuitDoc {
  return {
    version: 2,
    groups,
    sketchFileId,
    parts: nodes.map((n) => ({
      id: n.id,
      type: n.data.partType,
      label: n.data.label,
      attrs: n.data.attrs,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      rotation: n.data.rotation ?? 0,
    })),
    wires: edges.map((e) => ({
      id: e.id,
      from: { part: e.source, pin: e.sourceHandle ?? "" },
      to: { part: e.target, pin: e.targetHandle ?? "" },
    })),
  };
}

function ImportDialog({ onImport }: { onImport: (doc: CircuitDoc) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const parsed = JSON.parse(text) as WokwiDiagram;
      if (!Array.isArray(parsed.parts)) throw new Error("No parts array found");
      const doc = wokwiDiagramToDoc(parsed);
      if (doc.parts.length === 0) throw new Error("Diagram contains no parts");
      onImport(doc);
      setOpen(false);
      setText("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid diagram JSON");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="xs" className="gap-1">
            <FileDown className="size-3" /> Import
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import a Wokwi diagram</DialogTitle>
          <DialogDescription>
            Paste a <span className="font-mono text-xs">diagram.json</span> from wokwi.com (or ask
            the copilot to import one). It replaces the current schematic.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"version": 1, "parts": [...], "connections": [...]}'
            rows={10}
            className="bg-background focus-visible:border-ring rounded-none border p-2.5 font-mono text-xs outline-none"
            aria-label="Wokwi diagram JSON"
          />
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          <Button type="submit" size="sm" disabled={!text.trim()}>
            Import diagram
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type CanvasProps = { projectId: string; branchId: string; canEdit: boolean };

/** Provider wrapper: the inner canvas needs screenToFlowPosition for regions. */
export function CircuitCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CircuitCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CircuitCanvasInner({ projectId, branchId, canEdit }: CanvasProps) {
  const query = trpc.design.get.useQuery({ projectId, branchId, kind: "CIRCUIT" });
  const save = trpc.design.save.useMutation();

  const [nodes, setNodes, onNodesChange] = useNodesState<PartNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [groups, setGroups] = useState<CircuitGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  /** Region being dragged out, in flow coordinates. */
  const [groupDraft, setGroupDraft] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [groupTool, setGroupTool] = useState(false);
  const [sketchFileId, setSketchFileId] = useState<string | null>(null);
  const utils = trpc.useUtils();
  // Sketches live in the Code stage, so the picker lists that stage's files.
  const codeFiles = trpc.code.listProjectFiles.useQuery({ projectId, branchId });
  const reposQuery = trpc.engineer.listRepos.useQuery({ projectId, branchId });
  const createFile = trpc.code.createFile.useMutation();
  const sketchFile = trpc.code.getFile.useQuery(
    { id: sketchFileId ?? "" },
    { enabled: Boolean(sketchFileId) },
  );
  /** Runnable sketches: JavaScript only, since that is what the runtime executes. */
  const runnableFiles = useMemo(
    () => (codeFiles.data ?? []).filter((f) => /\.(js|mjs)$/i.test(f.path)),
    [codeFiles.data],
  );
  const [simRunning, setSimRunning] = useState(false);
  const [simOutputs, setSimOutputs] = useState<Map<string, number>>(new Map());
  const [simLogs, setSimLogs] = useState<string[]>([]);
  const [simError, setSimError] = useState<string | null>(null);
  const [simFault, setSimFault] = useState<{ conflicts: number; unstable: boolean }>({
    conflicts: 0,
    unstable: false,
  });
  const [showSerial, setShowSerial] = useState(true);
  const [simPins, setSimPins] = useState<{ pin: string; level: 0 | 1 | null }[]>([]);
  /** Live simulator, so interaction handlers can poke it between ticks. */
  const simRef = useRef<{ sim: Simulator; handle: SketchHandle | null } | null>(null);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ nodes, edges, groups, sketchFileId, source: "" });
  stateRef.current = { ...stateRef.current, nodes, edges, groups, sketchFileId };
  const saveRef = useRef(save);
  saveRef.current = save;

  const scheduleSave = useCallback(() => {
    if (!canEdit) return;
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const { nodes: n, edges: e, groups: g, sketchFileId: f } = stateRef.current;
      saveRef.current.mutate(
        { projectId, branchId, kind: "CIRCUIT", data: graphToDoc(n, e, g, f ?? undefined) },
        { onSuccess: () => (dirtyRef.current = false) },
      );
    }, 800);
  }, [canEdit, projectId, branchId]);

  // Adopt server state (e.g. copilot edits) whenever we have no unsaved edits.
  useEffect(() => {
    if (dirtyRef.current) return;
    const doc = query.data ? normalizeCircuitDoc(query.data.data) : EMPTY_CIRCUIT;
    const graph = docToGraph(doc, canEdit);
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setGroups(doc.groups);
    setSketchFileId(doc.sketchFileId ?? null);
  }, [query.data, canEdit, setNodes, setEdges]);

  /**
   * The simulation loop. Rebuilt whenever the schematic or sketch changes,
   * because both the net topology and the compiled program depend on them.
   *
   * Runs at 20 Hz against a virtual clock rather than per animation frame: the
   * sketch's time is its own, so wall-clock pacing only controls how fast you
   * watch it, and a lower rate keeps React Flow from re-rendering constantly.
   */
  useEffect(() => {
    if (!simRunning) return;

    const doc = graphToDoc(stateRef.current.nodes, stateRef.current.edges, stateRef.current.groups);
    const sim = new Simulator(doc);
    const mcu = doc.parts.find((p) => MCU_TYPES.has(p.type));
    const handle = mcu ? runSketch(sim, mcu.id, stateRef.current.source) : null;

    // Run setup, then settle, before any loop() body executes. setup() is what
    // configures the pull-ups, and the settle turns those into levels — without
    // this ordering the first loop() reads every pin as floating, so a pulled-up
    // input reports LOW and the sketch sees a button press that never happened.
    handle?.advance(0);
    sim.step();

    simRef.current = { sim, handle };
    setSimError(
      handle?.error ??
        (!mcu
          ? "No microcontroller on the schematic."
          : !stateRef.current.source
            ? "No sketch selected — pick a .js file from the Code stage."
            : null),
    );

    const startedAt = performance.now();
    const timer = setInterval(() => {
      // Virtual time tracks wall time so a delay(500) feels like half a second.
      handle?.advance((performance.now() - startedAt) * 1000);
      const snap = sim.step();
      setSimOutputs(new Map(snap.outputs));
      setSimFault({ conflicts: snap.conflicts, unstable: snap.unstable });
      // Live pin monitor for the MCU's digital pins — the readout you actually
      // want when a sketch does not do what you expected.
      if (mcu) {
        setSimPins(
          Array.from({ length: 14 }, (_, i) => ({
            pin: String(i),
            level: sim.pinState(mcu.id, String(i)).level,
          })),
        );
      }
      if (handle) {
        setSimLogs([...handle.logs]);
        if (handle.error) setSimError(handle.error);
      }
    }, 50);

    return () => {
      clearInterval(timer);
      simRef.current = null;
    };
    // Restarts when the selected file's contents change, so editing the sketch
    // in the Code stage and coming back re-runs the new version.
  }, [simRunning, sketchFile.data?.content, nodes.length, edges.length]);

  // Keep the source the run loop reads in step with the selected file.
  stateRef.current.source = sketchFile.data?.content ?? "";

  /** Creates a starter sketch in the firmware repo and selects it. */
  const createSketch = useCallback(async () => {
    const repo = reposQuery.data?.[0];
    if (!repo) return;
    const made = await createFile.mutateAsync({
      repoId: repo.id,
      path: "sim/sketch.js",
      content: DEFAULT_SKETCH,
    });
    await utils.code.listProjectFiles.invalidate();
    setSketchFileId(made.id);
    scheduleSave();
  }, [reposQuery.data, createFile, utils, scheduleSave]);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!canEdit || !conn.source || !conn.target) return;
      setEdges((es) => [
        ...es,
        {
          id: uid("w"),
          source: conn.source,
          sourceHandle: conn.sourceHandle,
          target: conn.target,
          targetHandle: conn.targetHandle,
          type: "smoothstep",
          style: WIRE_STYLE,
        },
      ]);
      scheduleSave();
    },
    [canEdit, setEdges, scheduleSave],
  );

  const addPart = useCallback(
    (type: string) => {
      const entry = catalogEntry(type);
      const count = stateRef.current.nodes.filter((n) => n.data.partType === type).length + 1;
      setNodes((ns) => [
        ...ns,
        {
          id: uid("p"),
          type: "wokwi" as const,
          position: {
            x: 80 + ((ns.length * 90) % 640),
            y: 80 + Math.floor(ns.length / 8) * 140,
          },
          data: {
            partType: type,
            label: entry ? `${entry.name} ${count}` : type,
            attrs: entry?.defaultAttrs ? { ...entry.defaultAttrs } : undefined,
            rotation: 0,
            canEdit,
            wirePins: [],
          },
          draggable: canEdit,
        },
      ]);
      scheduleSave();
    },
    [canEdit, setNodes, scheduleSave],
  );

  const importDoc = useCallback(
    (doc: CircuitDoc) => {
      const graph = docToGraph(doc, canEdit);
      setNodes(graph.nodes);
      setEdges(graph.edges);
      scheduleSave();
    },
    [canEdit, setNodes, setEdges, scheduleSave],
  );

  const patchSelected = useCallback(
    (patch: Partial<Pick<CircuitPart, "label" | "attrs" | "rotation">>) => {
      if (!selectedId) return;
      setNodes((ns) =>
        ns.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
      scheduleSave();
    },
    [selectedId, setNodes, scheduleSave],
  );

  const { screenToFlowPosition } = useReactFlow();

  // Live cursors. Positions are published in flow coordinates so a peer's
  // pointer lands on the same part for everyone, whatever their pan and zoom.
  const viewer = trpc.project.viewer.useQuery();
  const cursors = useCursors(projectId, branchId, "schematic", {
    userId: viewer.data?.id ?? "anonymous",
    name: viewer.data?.name ?? "Someone",
  });
  const reportCursor = cursors.report;

  const onCanvasPointerMove = useCallback(
    (e: React.MouseEvent) => {
      const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      reportCursor(at.x, at.y);
    },
    [screenToFlowPosition, reportCursor],
  );
  /** Anchor of the region drag, in flow coordinates. */
  const groupAnchorRef = useRef<{ x: number; y: number } | null>(null);

  const onPaneMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!groupTool || !canEdit || e.button !== 0) return;
      const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      groupAnchorRef.current = at;
      setGroupDraft({ x: at.x, y: at.y, w: 0, h: 0 });
    },
    [groupTool, canEdit, screenToFlowPosition],
  );

  const onPaneMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const anchor = groupAnchorRef.current;
      if (!anchor) return;
      const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // Normalised so dragging up or left still yields a positive extent.
      setGroupDraft({
        x: Math.min(anchor.x, at.x),
        y: Math.min(anchor.y, at.y),
        w: Math.abs(at.x - anchor.x),
        h: Math.abs(at.y - anchor.y),
      });
    },
    [screenToFlowPosition],
  );

  const addGroup = useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      // A stray click is a zero-size drag, not an attempt to make a board.
      if (rect.w < 40 || rect.h < 40) return;
      const id = uid("g");
      setGroups((gs) => [
        ...gs,
        {
          id,
          label: `Board ${gs.length + 1}`,
          ...rect,
          color: GROUP_COLORS[gs.length % GROUP_COLORS.length],
        },
      ]);
      setActiveGroupId(id);
      // One region per activation: the tool suppresses panning while it is on,
      // so leaving it armed would look like a broken canvas.
      setGroupTool(false);
      scheduleSave();
    },
    [scheduleSave],
  );

  const onPaneMouseUp = useCallback(() => {
    const draft = groupDraft;
    groupAnchorRef.current = null;
    setGroupDraft(null);
    if (draft) addGroup(draft);
  }, [groupDraft, addGroup]);

  const patchGroup = useCallback(
    (id: string, patch: Partial<CircuitGroup>) => {
      setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
      scheduleSave();
    },
    [scheduleSave],
  );

  const deleteGroup = useCallback(
    (id: string) => {
      setGroups((gs) => gs.filter((g) => g.id !== id));
      setActiveGroupId((current) => (current === id ? null : current));
      scheduleSave();
    },
    [scheduleSave],
  );

  /**
   * Press or toggle a part during a simulation. Momentary parts release on
   * pointer-up anywhere, so dragging off the button does not leave it stuck.
   */
  const interact = useCallback((partId: string) => {
    const live = simRef.current;
    if (!live) return;
    const type = stateRef.current.nodes.find((n) => n.id === partId)?.data.partType;
    const model = type ? partModel(type) : undefined;
    if (!model?.interactive) return;

    if (model.interactive === "latching") {
      const current = live.sim.stateOf(partId);
      if ("position" in current)
        live.sim.setPartState(partId, { position: current.position ? 0 : 1 });
      else live.sim.setPartState(partId, { pressed: !current.pressed });
      return;
    }

    live.sim.setPartState(partId, { pressed: true });
    const release = () => {
      live.sim.setPartState(partId, { pressed: false });
      window.removeEventListener("pointerup", release);
    };
    window.addEventListener("pointerup", release);
  }, []);

  // Simulation state is pushed onto the nodes so the Wokwi elements light up.
  // Only touched while running, so the editor keeps its plain appearance.
  const simNodes = useMemo(() => {
    if (!simRunning) return nodes;
    return nodes.map((n) => {
      const value = simOutputs.get(n.id);
      const canPress = Boolean(partModel(n.data.partType)?.interactive);
      if (value === undefined && !canPress) return n;
      return {
        ...n,
        data: { ...n.data, simValue: value ?? 0, onInteract: canPress ? interact : undefined },
      };
    });
  }, [nodes, simRunning, simOutputs, interact]);

  const { theme } = useTheme();
  const results = useMemo(() => searchCatalog(search), [search]);
  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const isDark = theme.mode === "dark";

  // Live view of how the schematic splits across boards. Recomputed from the
  // canvas state rather than the saved document so dragging a part between
  // regions updates the crossing count immediately.
  const partition = useMemo(
    () => partitionBoards(graphToDoc(nodes, edges, groups)),
    [nodes, edges, groups],
  );
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;
  const activeSlice = partition.slices.find((s) => s.group.id === activeGroupId) ?? null;

  return (
    <div
      className="bg-background absolute inset-0"
      // React Flow exposes no pane mouse-down, so the region drag is handled on
      // the container. Every handler no-ops unless the region tool is active.
      onMouseDown={onPaneMouseDown}
      onMouseMove={(e) => {
        onPaneMouseMove(e);
        onCanvasPointerMove(e);
      }}
      onMouseUp={onPaneMouseUp}
      onMouseLeave={onPaneMouseUp}
    >
      <ReactFlow
        nodes={simNodes}
        edges={edges}
        nodeTypes={circuitNodeTypes}
        onNodesChange={(changes) => {
          onNodesChange(changes);
          if (changes.some((c) => c.type === "position" || c.type === "remove")) scheduleSave();
        }}
        onEdgesChange={(changes) => {
          onEdgesChange(changes);
          if (changes.some((c) => c.type === "remove")) scheduleSave();
        }}
        onConnect={onConnect}
        onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id ?? null)}
        connectionMode={ConnectionMode.Loose}
        nodesConnectable={canEdit}
        elementsSelectable
        // Dragging out a region must not pan the canvas at the same time.
        panOnDrag={!groupTool}
        deleteKeyCode={canEdit ? ["Backspace", "Delete"] : []}
        fitView
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        colorMode={theme.mode}
        className="!bg-transparent"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.2}
          color="var(--color-border)"
        />

        <CursorLayer peers={cursors.peers} />

        <GroupLayer
          groups={groups}
          partition={partition}
          activeId={activeGroupId}
          onSelect={setActiveGroupId}
        />

        {groupDraft ? (
          <ViewportPortal>
            <div
              style={{
                position: "absolute",
                transform: `translate(${groupDraft.x}px, ${groupDraft.y}px)`,
                width: groupDraft.w,
                height: groupDraft.h,
                border: "2px dashed var(--color-primary)",
                borderRadius: 12,
                background: "rgb(56 189 248 / 0.08)",
                pointerEvents: "none",
              }}
            />
          </ViewportPortal>
        ) : null}
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          className="!bg-card/90 rounded-none border"
          nodeColor="var(--color-primary)"
          maskColor={isDark ? "rgb(30 30 30 / 0.75)" : "rgb(245 245 245 / 0.75)"}
        />

        {canEdit ? (
          <Panel position="top-left" className="!m-3">
            <div className="bg-card/90 flex w-64 flex-col rounded-none border shadow-lg backdrop-blur-md">
              <div className="flex items-center gap-1.5 border-b p-2">
                <Search className="text-muted-foreground ml-1 size-3.5 shrink-0" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search parts…"
                  aria-label="Search parts"
                  className="h-7 border-none bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
                />
                <ImportDialog onImport={importDoc} />
              </div>
              <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto p-1.5">
                {results.length === 0 ? (
                  <p className="text-muted-foreground p-2 text-xs">
                    No parts match. Ask the copilot to search the web for it.
                  </p>
                ) : (
                  results.map((entry) => (
                    <button
                      key={entry.type}
                      type="button"
                      onClick={() => addPart(entry.type)}
                      className="hover:bg-muted/60 flex items-center gap-2 rounded-none px-2 py-1 text-left text-xs transition-colors"
                    >
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      <span className="text-muted-foreground text-[10px]">{entry.category}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </Panel>
        ) : null}

        {selected && canEdit ? (
          <Panel position="top-right" className="!m-3">
            <div className="bg-card/90 flex w-56 flex-col gap-2 rounded-none border p-2.5 shadow-lg backdrop-blur-md">
              <Input
                value={selected.data.label ?? ""}
                onChange={(e) => patchSelected({ label: e.target.value })}
                placeholder="Label"
                aria-label="Part label"
                className="h-7 text-xs"
              />
              {["value", "color"].map((key) =>
                selected.data.attrs && key in selected.data.attrs ? (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-muted-foreground w-10 text-[10px] uppercase">{key}</span>
                    <Input
                      value={selected.data.attrs[key] ?? ""}
                      onChange={(e) =>
                        patchSelected({ attrs: { ...selected.data.attrs, [key]: e.target.value } })
                      }
                      aria-label={`Part ${key}`}
                      className="h-7 flex-1 text-xs"
                    />
                  </div>
                ) : null,
              )}
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    patchSelected({ rotation: ((selected.data.rotation ?? 0) + 90) % 360 })
                  }
                >
                  <RotateCw className="size-3" /> Rotate
                </Button>
                <Button
                  variant="destructive"
                  size="xs"
                  className="ml-auto"
                  onClick={() => {
                    setNodes((ns) => ns.filter((n) => n.id !== selected.id));
                    setEdges((es) =>
                      es.filter((e) => e.source !== selected.id && e.target !== selected.id),
                    );
                    setSelectedId(null);
                    scheduleSave();
                  }}
                >
                  <Trash2 className="size-3" /> Delete
                </Button>
              </div>
            </div>
          </Panel>
        ) : null}

        {canEdit ? (
          <Panel position="top-center" className="!m-3">
            <div className="bg-card/90 flex max-w-md flex-col gap-2 rounded-xl border p-2.5 shadow-lg backdrop-blur-md">
              <div className="flex items-center gap-1.5">
                <Button
                  variant={groupTool ? "secondary" : "outline"}
                  size="xs"
                  onClick={() => setGroupTool((t) => !t)}
                  aria-pressed={groupTool}
                  title="Drag a rectangle around the parts that become one board"
                >
                  <SquareDashed className="size-3" /> Board region
                </Button>
                <span className="text-muted-foreground text-[10px]">
                  {groups.length === 0
                    ? "No regions — the whole schematic is one board."
                    : `${groups.length} board${groups.length === 1 ? "" : "s"} · ${partition.crossings.length} net${partition.crossings.length === 1 ? "" : "s"} crossing`}
                </span>
              </div>

              {activeGroup ? (
                <div className="flex flex-col gap-1.5 border-t pt-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={activeGroup.label}
                      onChange={(e) => patchGroup(activeGroup.id, { label: e.target.value })}
                      className="h-7 flex-1 text-xs"
                      aria-label="Board region name"
                    />
                    <Button
                      variant="destructive"
                      size="xs"
                      onClick={() => deleteGroup(activeGroup.id)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-[10px] leading-snug">
                    {activeSlice?.partIds.length ?? 0} parts ·{" "}
                    {activeSlice?.internalNets.length ?? 0} internal nets ·{" "}
                    {activeSlice?.crossingNets.length ?? 0} needing a connector
                  </p>
                  {activeSlice && activeSlice.crossingNets.length > 0 ? (
                    <p className="text-[10px] leading-snug text-amber-500">
                      Leaves this board: {activeSlice.crossingNets.join(", ")}. Each needs a
                      connector footprint on both boards.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {partition.overlaps.length > 0 ? (
                <p className="text-[10px] leading-snug text-amber-500">
                  {partition.overlaps.map((o) => `${o.aLabel} and ${o.bLabel} overlap`).join("; ")}.
                  Parts in the shared area go to the first region.
                </p>
              ) : null}

              {groups.length > 0 && partition.ungroupedPartIds.length > 0 ? (
                <p className="text-muted-foreground text-[10px] leading-snug">
                  {partition.ungroupedPartIds.length} part
                  {partition.ungroupedPartIds.length === 1 ? "" : "s"} outside every region — they
                  are on no board yet.
                </p>
              ) : null}
            </div>
          </Panel>
        ) : null}

        <Panel position="bottom-right" className="!mr-3 !mb-44">
          <div className="bg-card/95 flex w-80 flex-col rounded-xl border shadow-xl backdrop-blur-md">
            {/* Control bar */}
            <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
              <Button
                variant={simRunning ? "destructive" : "default"}
                size="xs"
                disabled={!canEdit}
                onClick={() => setSimRunning((r) => !r)}
                aria-pressed={simRunning}
              >
                {simRunning ? <Square className="size-3" /> : <Play className="size-3" />}
                {simRunning ? "Stop" : "Run"}
              </Button>

              <select
                value={sketchFileId ?? ""}
                onChange={(e) => {
                  setSketchFileId(e.target.value || null);
                  scheduleSave();
                }}
                className="bg-background min-w-0 flex-1 rounded-md border px-1.5 py-1 font-mono text-[10px]"
                aria-label="Simulation sketch"
                disabled={!canEdit}
              >
                <option value="">no sketch</option>
                {runnableFiles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.path}
                  </option>
                ))}
              </select>

              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase",
                  simRunning ? "bg-amber-500/15 text-amber-500" : "text-muted-foreground",
                )}
                title="Behavioural simulation, not compiled firmware"
              >
                {simRunning ? "simulated" : "idle"}
              </span>
            </div>

            {/* No sketch yet: offer to make one in the Code stage. */}
            {runnableFiles.length === 0 ? (
              <div className="flex items-center gap-2 border-b px-2 py-1.5">
                <p className="text-muted-foreground flex-1 text-[10px] leading-snug">
                  No .js sketches in Code yet.
                </p>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!canEdit || !reposQuery.data?.length || createFile.isPending}
                  onClick={() => void createSketch()}
                >
                  <Code2 className="size-3" /> Create
                </Button>
              </div>
            ) : null}

            {/* Faults first — they explain everything below them. */}
            {simError ? (
              <p className="text-destructive flex items-start gap-1 border-b px-2 py-1.5 text-[10px] leading-snug">
                <AlertTriangle className="mt-px size-3 shrink-0" />
                {simError}
              </p>
            ) : null}

            {simRunning && (simFault.conflicts > 0 || simFault.unstable) ? (
              <p className="flex items-start gap-1 border-b px-2 py-1.5 text-[10px] leading-snug text-amber-500">
                <AlertTriangle className="mt-px size-3 shrink-0" />
                {simFault.conflicts > 0
                  ? `${simFault.conflicts} net${simFault.conflicts === 1 ? "" : "s"} with two drivers fighting.`
                  : "Circuit never settled — likely a feedback loop."}
              </p>
            ) : null}

            {/* Digital pin monitor: the readout you want when a sketch misbehaves. */}
            {simRunning && simPins.length > 0 ? (
              <div className="grid grid-cols-7 gap-x-1 gap-y-0.5 border-b px-2 py-1.5">
                {simPins.map((p) => (
                  <div key={p.pin} className="flex flex-col items-center">
                    <span className="text-muted-foreground font-mono text-[9px]">{p.pin}</span>
                    <span
                      className={cn(
                        "h-1.5 w-full rounded-sm",
                        p.level === 1
                          ? "bg-emerald-500"
                          : p.level === 0
                            ? "bg-muted-foreground/40"
                            : "bg-muted-foreground/10",
                      )}
                      title={p.level === null ? "floating" : p.level ? "high" : "low"}
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {/* Serial monitor */}
            <button
              type="button"
              onClick={() => setShowSerial((v) => !v)}
              className="text-muted-foreground hover:bg-muted/40 flex items-center gap-1 px-2 py-1 text-[10px] font-semibold tracking-wide uppercase"
            >
              <Terminal className="size-3" /> Serial
              <span className="ml-auto font-normal normal-case">
                {simLogs.length > 0 ? `${simLogs.length} lines` : "—"}
              </span>
            </button>
            {showSerial ? (
              <div className="bg-background/80 max-h-32 overflow-y-auto px-2 pb-1.5 font-mono text-[10px] leading-relaxed">
                {simLogs.length === 0 ? (
                  <span className="text-muted-foreground">
                    {simRunning ? "No output — call print() in the sketch." : "Not running."}
                  </span>
                ) : (
                  simLogs.slice(-40).map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap">
                      {line}
                    </div>
                  ))
                )}
              </div>
            ) : null}

            <p className="text-muted-foreground border-t px-2 py-1.5 text-[10px] leading-snug">
              Runs the selected Code file as JavaScript with the Arduino API&apos;s shape, on a
              virtual clock. Not compiled firmware. Click buttons and switches while it runs.
            </p>
          </div>
        </Panel>

        <Panel position="bottom-center" className="!mb-3">
          <span className="bg-card/85 text-muted-foreground rounded-none border px-2.5 py-1 text-[11px] shadow backdrop-blur-md">
            {save.isPending
              ? "Saving…"
              : groupTool
                ? "Drag a rectangle to mark a board region"
                : simRunning
                  ? "Simulating · click buttons and switches to interact"
                  : "Autosaves · drag pins to wire · ⌫ deletes"}
          </span>
        </Panel>
      </ReactFlow>
    </div>
  );
}
