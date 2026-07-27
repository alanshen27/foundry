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
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FileDown, RotateCw, Search, Trash2 } from "lucide-react";
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
import { trpc } from "@/lib/trpc";

let seq = 1;
function uid(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${seq++}`;
}

function graphToDoc(nodes: PartNode[], edges: Edge[]): CircuitDoc {
  return {
    version: 2,
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

export function CircuitCanvas({
  projectId,
  branchId,
  canEdit,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
}) {
  const query = trpc.design.get.useQuery({ projectId, branchId, kind: "CIRCUIT" });
  const save = trpc.design.save.useMutation();

  const [nodes, setNodes, onNodesChange] = useNodesState<PartNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ nodes, edges });
  stateRef.current = { nodes, edges };
  const saveRef = useRef(save);
  saveRef.current = save;

  const scheduleSave = useCallback(() => {
    if (!canEdit) return;
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const { nodes: n, edges: e } = stateRef.current;
      saveRef.current.mutate(
        { projectId, branchId, kind: "CIRCUIT", data: graphToDoc(n, e) },
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

  const { theme } = useTheme();
  const results = useMemo(() => searchCatalog(search), [search]);
  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const isDark = theme.mode === "dark";

  return (
    <div className="bg-background absolute inset-0">
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
        deleteKeyCode={canEdit ? ["Backspace", "Delete"] : []}
        fitView
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        colorMode={theme.mode}
        className="!bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--color-border)" />
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

        <Panel position="bottom-center" className="!mb-3">
          <span className="bg-card/85 text-muted-foreground rounded-lg border px-2.5 py-1 text-[11px] shadow backdrop-blur-md">
            {save.isPending ? "Saving…" : "Autosaves · drag pins to wire · ⌫ deletes"}
          </span>
        </Panel>
      </ReactFlow>
    </div>
  );
}
