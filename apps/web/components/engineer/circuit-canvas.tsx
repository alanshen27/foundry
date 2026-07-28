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
import { FileDown, RotateCw, Search, SquareDashed, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

function graphToDoc(nodes: PartNode[], edges: Edge[], groups: CircuitGroup[] = []): CircuitDoc {
  return {
    version: 2,
    groups,
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
            className="bg-background focus-visible:border-ring rounded-lg border p-2.5 font-mono text-xs outline-none"
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
  const [groupDraft, setGroupDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const [groupTool, setGroupTool] = useState(false);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ nodes, edges, groups });
  stateRef.current = { nodes, edges, groups };
  const saveRef = useRef(save);
  saveRef.current = save;

  const scheduleSave = useCallback(() => {
    if (!canEdit) return;
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const { nodes: n, edges: e, groups: g } = stateRef.current;
      saveRef.current.mutate(
        { projectId, branchId, kind: "CIRCUIT", data: graphToDoc(n, e, g) },
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
  }, [query.data, canEdit, setNodes, setEdges]);

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
        { id, label: `Board ${gs.length + 1}`, ...rect, color: GROUP_COLORS[gs.length % GROUP_COLORS.length] },
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
      onMouseMove={onPaneMouseMove}
      onMouseUp={onPaneMouseUp}
      onMouseLeave={onPaneMouseUp}
    >
      <ReactFlow
        nodes={nodes}
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
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--color-border)" />

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
          className="!bg-card/90 rounded-lg border"
          nodeColor="var(--color-primary)"
          maskColor={isDark ? "rgb(30 30 30 / 0.75)" : "rgb(245 245 245 / 0.75)"}
        />

        {canEdit ? (
          <Panel position="top-left" className="!m-3">
            <div className="bg-card/90 flex w-64 flex-col rounded-xl border shadow-lg backdrop-blur-md">
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
                      className="hover:bg-muted/60 flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors"
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
            <div className="bg-card/90 flex w-56 flex-col gap-2 rounded-xl border p-2.5 shadow-lg backdrop-blur-md">
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
                  onClick={() => patchSelected({ rotation: ((selected.data.rotation ?? 0) + 90) % 360 })}
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
                  {partition.overlaps
                    .map((o) => `${o.aLabel} and ${o.bLabel} overlap`)
                    .join("; ")}
                  . Parts in the shared area go to the first region.
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

        <Panel position="bottom-center" className="!mb-3">
          <span className="bg-card/85 text-muted-foreground rounded-lg border px-2.5 py-1 text-[11px] shadow backdrop-blur-md">
            {save.isPending
              ? "Saving…"
              : groupTool
                ? "Drag a rectangle to mark a board region"
                : "Autosaves · drag pins to wire · ⌫ deletes"}
          </span>
        </Panel>
      </ReactFlow>
    </div>
  );
}
