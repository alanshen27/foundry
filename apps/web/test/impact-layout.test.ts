import { describe, expect, it } from "vitest";
import { deriveGraph } from "@/lib/graph/derive";
import { impactFrom } from "@/lib/graph/impact";
import { COLUMN_WIDTH, layoutImpactGraph } from "@/lib/graph/impact-layout";
import type { GraphEdge, GraphSnapshot } from "@/lib/graph/types";
import { authoredEdges, envMonitorInput } from "./fixtures/env-monitor";

const ROOT = "component:cmp-battery";

function impact() {
  const derived = deriveGraph(envMonitorInput);
  const graph: GraphSnapshot = {
    nodes: derived.nodes.map((n, i) => ({ ...n, id: `n${i}` })),
    edges: [
      ...derived.edges.map((e, i) => ({ ...e, id: `e${i}` })),
      ...authoredEdges.map((e, i) => ({ ...e, id: `a${i}`, rule: null }) as GraphEdge),
    ],
  };
  return impactFrom(graph, ROOT);
}
const root = { refKey: ROOT, label: "BT1 Battery" };

describe("layoutImpactGraph", () => {
  it("puts the change alone in the first column and consequences to its right", () => {
    const { nodes } = layoutImpactGraph(root, impact());
    const first = nodes.filter((n) => n.column === 0);
    expect(first.map((n) => n.id)).toEqual([ROOT]);
    expect(first[0]!.severity).toBe("root");
    for (const n of nodes) expect(n.x).toBe(n.column * COLUMN_WIDTH);
  });

  it("hides wiring by default but still connects the battery to the firmware", () => {
    const { nodes, edges } = layoutImpactGraph(root, impact());
    expect(nodes.some((n) => n.kind === "NET" || n.kind === "MCU_PIN")).toBe(false);
    const toMain = edges.find((e) => e.target === "codefile:file-main");
    expect(toMain).toBeDefined();
    // Collapsed across the MCU's schematic part, the net and the pin.
    expect(toMain!.source).toBe("component:cmp-mcu");
    expect(toMain!.collapsed).toBe(3);
  });

  it("draws every hop when wiring is included", () => {
    const { nodes, edges } = layoutImpactGraph(root, impact(), { includeStructural: true });
    expect(nodes.some((n) => n.id === "net:LED_CTRL")).toBe(true);
    expect(edges.every((e) => e.collapsed === 0)).toBe(true);
    expect(edges.find((e) => e.target === "codefile:file-main")!.source).toBe("pin:u1:D2");
  });

  it("only draws edges between nodes it drew", () => {
    const { nodes, edges } = layoutImpactGraph(root, impact());
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it("caps the picture and says how much it left out", () => {
    const all = impact();
    const { nodes, omitted } = layoutImpactGraph(root, all, {
      includeStructural: true,
      maxNodes: 5,
    });
    expect(nodes).toHaveLength(5);
    expect(omitted).toBe(all.length - 4);
  });

  it("is deterministic", () => {
    expect(layoutImpactGraph(root, impact())).toEqual(layoutImpactGraph(root, impact()));
  });

  it("does not stack two nodes on the same spot", () => {
    const { nodes } = layoutImpactGraph(root, impact(), { includeStructural: true });
    const spots = new Set(nodes.map((n) => `${n.x},${n.y}`));
    expect(spots.size).toBe(nodes.length);
  });
});
