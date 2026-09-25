/**
 * `diffGraphs` against a hand-built pair of branches, same discipline as
 * `graph-impact.test.ts`: the expectation is written by reading what changed
 * in the fixture, not by running the function and recording its output.
 */

import { describe, expect, it } from "vitest";
import { diffGraphs } from "@/lib/graph/compare";
import { deriveGraph } from "@/lib/graph/derive";
import type { GraphEdge, GraphSnapshot } from "@/lib/graph/types";
import { authoredEdges, envMonitorInput } from "./fixtures/env-monitor";

/** Same construction as graph-impact.test.ts's buildGraph(). */
function buildGraph(input = envMonitorInput): GraphSnapshot {
  const derived = deriveGraph(input);
  return {
    nodes: derived.nodes.map((n, i) => ({ ...n, id: `n${i}` })),
    edges: [
      ...derived.edges.map((e, i) => ({ ...e, id: `e${i}` })),
      ...authoredEdges.map((e, i) => ({ ...e, id: `a${i}`, rule: null }) as GraphEdge),
    ],
  };
}

describe("diffGraphs", () => {
  const branchA = buildGraph();

  it("reports no differences between a branch and itself", () => {
    const diff = diffGraphs(branchA, buildGraph());
    expect(diff.nodes).toEqual([]);
    expect(diff.edges).toEqual([]);
    expect(diff.summary).toEqual({ added: 0, removed: 0, changed: 0 });
  });

  it("reports a changed node when its content hash moved", () => {
    // Same battery, different capacity — the requirement's contentHash is
    // derived from the requirement row itself, so mutate a component instead,
    // which is what the derive step hashes from the component's own fields.
    const revised = {
      ...envMonitorInput,
      components: envMonitorInput.components.map((c) =>
        c.id === "cmp-battery" ? { ...c, capacityMah: 3000 } : c,
      ),
    };
    const branchB = buildGraph(revised);
    const diff = diffGraphs(branchA, branchB);
    const batteryDiff = diff.nodes.find((n) => n.refKey === "component:cmp-battery");
    expect(batteryDiff?.status).toBe("changed");
    expect(diff.summary.changed).toBeGreaterThanOrEqual(1);
  });

  it("reports a removed node and its edges when a part is dropped", () => {
    const baseCircuit = envMonitorInput.circuit!;
    const revised = {
      ...envMonitorInput,
      components: envMonitorInput.components.filter((c) => c.id !== "cmp-resistor"),
      circuit: {
        ...baseCircuit,
        parts: baseCircuit.parts.filter((p) => p.id !== "r1"),
        // Drop the wires that touched the removed part so derive() stays consistent.
        wires: baseCircuit.wires.filter((w) => w.from.part !== "r1" && w.to.part !== "r1"),
      },
    };
    const branchB = buildGraph(revised);
    const diff = diffGraphs(branchA, branchB);
    const resistorDiff = diff.nodes.find((n) => n.refKey === "component:cmp-resistor");
    expect(resistorDiff?.status).toBe("removed");
    expect(diff.summary.removed).toBeGreaterThanOrEqual(1);
    const resistorPartDiff = diff.nodes.find((n) => n.refKey === "circuitpart:r1");
    expect(resistorPartDiff?.status).toBe("removed");
  });

  it("reports an added node for a task that only exists on one branch", () => {
    const taskNode = {
      id: "task-x",
      kind: "TASK" as const,
      refKey: "task:t1",
      label: "Write the power driver",
      data: { status: "todo" },
      origin: "USER" as const,
    };
    const branchB: GraphSnapshot = { nodes: [...branchA.nodes, taskNode], edges: branchA.edges };
    const diff = diffGraphs(branchA, branchB);
    expect(diff.nodes).toEqual([
      expect.objectContaining({ refKey: "task:t1", status: "added", label: taskNode.label }),
    ]);
    expect(diff.summary).toEqual({ added: 1, removed: 0, changed: 0 });
  });

  it("does not report a changed edge for confidence/evidence drift alone", () => {
    // Same endpoints and kind, different confidence — provenance, not a diff-worthy change.
    const branchB: GraphSnapshot = {
      nodes: branchA.nodes,
      edges: branchA.edges.map((e) =>
        e.kind === "SATISFIES" && e.from === "component:cmp-battery"
          ? { ...e, confidence: 0.4, evidence: "revised rationale" }
          : e,
      ),
    };
    const diff = diffGraphs(branchA, branchB);
    expect(diff.edges).toEqual([]);
  });

  it("reports an added edge that exists only on branch B", () => {
    const extra: GraphEdge = {
      id: "extra1",
      kind: "MITIGATES",
      from: "risk:r-new",
      to: "task:t1",
      origin: "USER",
      confidence: 1,
      evidence: "test-only edge",
    };
    const branchB: GraphSnapshot = { nodes: branchA.nodes, edges: [...branchA.edges, extra] };
    const diff = diffGraphs(branchA, branchB);
    expect(diff.edges).toEqual([
      expect.objectContaining({
        kind: "MITIGATES",
        from: "risk:r-new",
        to: "task:t1",
        status: "added",
      }),
    ]);
  });

  it("never reports the changed node itself as both added and removed", () => {
    const revised = {
      ...envMonitorInput,
      components: envMonitorInput.components.map((c) =>
        c.id === "cmp-mcu" ? { ...c, currentDrawMa: 25 } : c,
      ),
    };
    const diff = diffGraphs(branchA, buildGraph(revised));
    const refKeys = diff.nodes.map((n) => n.refKey);
    // No refKey should appear more than once across the diff result.
    expect(new Set(refKeys).size).toBe(refKeys.length);
  });
});
