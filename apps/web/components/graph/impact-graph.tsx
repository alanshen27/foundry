"use client";

/**
 * The picture of an impact result: the change on the left, consequences
 * fanning out to the right, one column per hop. Read-only — it explains, the
 * list beside it is where work gets done.
 */

import { useMemo } from "react";
import { Background, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import type { ImpactNode } from "@/lib/graph/impact";
import { layoutImpactGraph } from "@/lib/graph/impact-layout";

const SEVERITY_CLASS: Record<string, string> = {
  root: "border-primary bg-primary text-primary-foreground",
  review: "border-amber-500/60 bg-amber-500/10",
  likely: "border-muted-foreground/40 bg-card",
  possible: "border-dashed border-muted-foreground/30 bg-card text-muted-foreground",
};

export function ImpactGraph({
  root,
  impacted,
  includeStructural,
}: {
  root: { refKey: string; label: string };
  impacted: ImpactNode[];
  includeStructural: boolean;
}) {
  const layout = useMemo(
    () => layoutImpactGraph(root, impacted, { includeStructural }),
    [root, impacted, includeStructural],
  );

  const nodes: Node[] = layout.nodes.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.label },
    draggable: false,
    selectable: false,
    className: cn(
      "!w-44 !rounded-none !border !px-2 !py-1.5 !text-left !text-[11px] !shadow-none",
      SEVERITY_CLASS[n.severity],
    ),
  }));
  const edges: Edge[] = layout.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.collapsed > 0 ? `${e.kind.toLowerCase()} · via ${e.collapsed}` : e.kind.toLowerCase(),
    labelStyle: { fontSize: 9 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    style: e.collapsed > 0 ? { strokeDasharray: "4 3" } : undefined,
  }));

  return (
    <div className="flex h-full flex-col" data-testid="impact-graph">
      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
        >
          <Background gap={16} size={1} />
        </ReactFlow>
      </div>
      {layout.omitted > 0 ? (
        <p className="text-muted-foreground border-t px-4 py-2 text-[11px]">
          {layout.omitted} more not drawn — the list has every result.
        </p>
      ) : null}
    </div>
  );
}
