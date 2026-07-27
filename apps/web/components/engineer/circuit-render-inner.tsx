"use client";

import { useEffect, useMemo, useState } from "react";
import { Background, BackgroundVariant, ConnectionMode, ReactFlow, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CircuitDoc } from "@/lib/circuit/catalog";
import { circuitNodeTypes, docToGraph } from "@/components/engineer/circuit-nodes";
import { useTheme } from "@/components/theme-provider";

/** Readonly circuit view for headless screenshots. */
export function CircuitRenderInner({ doc }: { doc: CircuitDoc }) {
  const { theme } = useTheme();
  const graph = useMemo(() => docToGraph(doc, false), [doc]);

  // Wokwi part handles mount asynchronously (after each web component reports
  // its pinInfo). Edges passed before their handles exist are dropped by
  // React Flow, so hold them back until every referenced pin is in the DOM,
  // then signal readiness for the screenshotting browser.
  const [edges, setEdges] = useState<Edge[]>([]);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      const handlesReady = doc.wires.every((w) =>
        [w.from, w.to].every((end) =>
          document.querySelector(
            `.react-flow__node[data-id="${CSS.escape(end.part)}"] [data-handleid="${CSS.escape(end.pin)}"]`,
          ),
        ),
      );
      if (handlesReady || Date.now() - started > 8000) {
        clearInterval(timer);
        setEdges(graph.edges);
        // A few frames for React Flow to measure handles and draw the wires.
        setTimeout(() => {
          document.body.dataset.renderReady = "1";
        }, 600);
      }
    }, 150);
    return () => clearInterval(timer);
  }, [graph, doc]);

  return (
    <div className="bg-background absolute inset-0">
      <ReactFlow
        nodes={graph.nodes}
        edges={edges}
        nodeTypes={circuitNodeTypes}
        // Pin handles are all type="source" (any pin connects to any pin), so
        // edge lookup must be loose or every wire's target side is dropped.
        connectionMode={ConnectionMode.Loose}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnDrag={false}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
        colorMode={theme.mode}
        className="!bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--color-border)" />
      </ReactFlow>
    </div>
  );
}
