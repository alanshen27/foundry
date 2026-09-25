/**
 * The correctness claim the whole product graph rests on.
 *
 * The proposal commits to impact analysis with "no false negatives on a
 * hand-constructed dependency set". That set lives in fixtures/env-monitor.ts,
 * written from the product rather than from this implementation's output, and
 * this file is where it is enforced.
 */

import { describe, expect, it } from "vitest";
import { deriveGraph } from "@/lib/graph/derive";
import { findCycles, impactFrom, provenanceOf, renderPath } from "@/lib/graph/impact";
import type { GraphEdge, GraphSnapshot } from "@/lib/graph/types";
import {
  authoredEdges,
  envMonitorInput,
  EXPECTED_IMPACT,
  EXPECTED_UNAFFECTED,
} from "./fixtures/env-monitor";

/** The derived graph plus the edges a human or the copilot would have drawn. */
function buildGraph(): GraphSnapshot {
  const derived = deriveGraph(envMonitorInput);
  return {
    nodes: derived.nodes.map((n, i) => ({ ...n, id: `n${i}` })),
    edges: [
      ...derived.edges.map((e, i) => ({ ...e, id: `e${i}` })),
      ...authoredEdges.map((e, i) => ({ ...e, id: `a${i}`, rule: null }) as GraphEdge),
    ],
  };
}

describe("impactFrom against the hand-constructed dependency set", () => {
  const graph = buildGraph();

  for (const [root, expected] of Object.entries(EXPECTED_IMPACT)) {
    it(`reports no false negatives from ${root}`, () => {
      const got = impactFrom(graph, root).map((n) => n.refKey);
      // Containment, not equality: the proposal tolerates extra results and
      // does not tolerate misses.
      expect(got).toEqual(expect.arrayContaining(expected));
    });

    it(`does not sweep in unrelated artifacts from ${root}`, () => {
      const got = impactFrom(graph, root).map((n) => n.refKey);
      // The teeth. Returning the whole project would satisfy the test above.
      for (const unaffected of EXPECTED_UNAFFECTED[root] ?? []) {
        expect(got).not.toContain(unaffected);
      }
      expect(got.length).toBeLessThan(graph.nodes.length);
    });
  }

  it("never includes the changed node itself", () => {
    for (const root of Object.keys(EXPECTED_IMPACT)) {
      expect(impactFrom(graph, root).map((n) => n.refKey)).not.toContain(root);
    }
  });

  it("returns an empty result for a node that is not in the graph", () => {
    expect(impactFrom(graph, "component:does-not-exist")).toEqual([]);
  });
});

describe("impact paths", () => {
  const graph = buildGraph();

  it("explains the firmware hit by the whole chain from the battery", () => {
    const main = impactFrom(graph, "component:cmp-battery").find(
      (n) => n.refKey === "codefile:file-main",
    );
    expect(main).toBeDefined();
    // Battery -> MCU -> its schematic part -> a net -> a pin -> the firmware.
    // Every hop derived; none of it authored.
    expect(main!.path.map((h) => h.kind)).toEqual([
      "POWERS",
      "REALIZED_BY",
      "CONNECTS",
      "CONNECTS",
      "DRIVES",
    ]);
    expect(main!.depth).toBe(5);
    expect(renderPath(main!)).toMatch(/^BT1 Battery.*src\/main\.cpp$/);
  });

  it("reaches directly-powered parts first and by the shortest path", () => {
    const mcu = impactFrom(graph, "component:cmp-battery").find(
      (n) => n.refKey === "component:cmp-mcu",
    );
    expect(mcu).toMatchObject({ depth: 1, confidence: 1, severity: "review" });
    expect(mcu!.reason).toBe("is powered by BT1 Battery, LiPo 2000 mAh");
  });

  it("downgrades a result reached only through a heuristic", () => {
    const bay = impactFrom(graph, "component:cmp-battery").find(
      (n) => n.refKey === "cadpart:parts/battery-bay.kcl",
    );
    // cad-houses is a name guess, so it lands at 0.5 and is labelled "likely"
    // rather than presented with the certainty of a structural link.
    expect(bay).toMatchObject({ confidence: 0.5, severity: "likely" });
  });

  it("sorts nearest and most confident first", () => {
    const results = impactFrom(graph, "component:cmp-battery");
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1]!;
      const curr = results[i]!;
      expect(prev.depth).toBeLessThanOrEqual(curr.depth);
      if (prev.depth === curr.depth) {
        expect(prev.confidence).toBeGreaterThanOrEqual(curr.confidence);
      }
    }
  });
});

describe("traversal limits", () => {
  const graph = buildGraph();

  it("honours maxDepth", () => {
    const shallow = impactFrom(graph, "component:cmp-battery", { maxDepth: 1 });
    expect(shallow.every((n) => n.depth === 1)).toBe(true);
    expect(shallow.map((n) => n.refKey)).not.toContain("codefile:file-main");
  });

  it("prunes results below the confidence floor", () => {
    const strict = impactFrom(graph, "component:cmp-battery", { minConfidence: 0.9 });
    // The battery bay is only a 0.5 name guess.
    expect(strict.map((n) => n.refKey)).not.toContain("cadpart:parts/battery-bay.kcl");
    expect(strict.every((n) => n.confidence >= 0.9)).toBe(true);
  });

  it("honours maxResults", () => {
    expect(impactFrom(graph, "component:cmp-battery", { maxResults: 3 })).toHaveLength(3);
  });

  it("terminates on a cycle instead of looping", () => {
    const cyclic: GraphSnapshot = {
      nodes: ["a", "b", "c"].map((k) => ({
        id: k,
        kind: "TASK" as const,
        refKey: `task:${k}`,
        label: k.toUpperCase(),
        origin: "USER" as const,
      })),
      edges: [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ].map(([from, to], i) => ({
        id: `e${i}`,
        kind: "DEPENDS_ON" as const,
        from: `task:${from}`,
        to: `task:${to}`,
        origin: "USER" as const,
        confidence: 1,
      })),
    };
    const got = impactFrom(cyclic, "task:a").map((n) => n.refKey);
    expect(got).toEqual(["task:b", "task:c"]);
  });
});

describe("provenanceOf", () => {
  const graph = buildGraph();

  it("answers why a requirement's check exists by walking back to the target", () => {
    const { justifiedBy } = provenanceOf(graph, "check:chk-battery");
    // The check exists because it verifies the battery.
    expect(justifiedBy.map((n) => n.refKey)).toContain("component:cmp-battery");
  });

  it("walks against the arrows, not along them", () => {
    const forward = impactFrom(graph, "component:cmp-battery").map((n) => n.refKey);
    const back = provenanceOf(graph, "component:cmp-battery").justifiedBy.map((n) => n.refKey);
    expect(forward).toContain("component:cmp-mcu");
    expect(back).not.toContain("component:cmp-mcu");
  });

  it("returns the node it was asked about", () => {
    expect(provenanceOf(graph, "component:cmp-battery").node?.refKey).toBe("component:cmp-battery");
    expect(provenanceOf(graph, "component:nope").node).toBeNull();
  });
});

describe("findCycles", () => {
  const nodesFor = (keys: string[]) =>
    keys.map((k) => ({
      id: k,
      kind: "TASK" as const,
      refKey: k,
      label: k.replace("task:", "").toUpperCase(),
      origin: "USER" as const,
    }));
  const edgesFor = (pairs: [string, string][]): GraphEdge[] =>
    pairs.map(([from, to], i) => ({
      id: `e${i}`,
      kind: "DEPENDS_ON",
      from,
      to,
      origin: "USER",
      confidence: 1,
    }));

  it("returns the tasks in the loop, in order", () => {
    const graph: GraphSnapshot = {
      nodes: nodesFor(["task:a", "task:b", "task:c"]),
      edges: edgesFor([
        ["task:a", "task:b"],
        ["task:b", "task:c"],
        ["task:c", "task:a"],
      ]),
    };
    expect(findCycles(graph, ["DEPENDS_ON"])).toEqual([["task:a", "task:b", "task:c"]]);
  });

  it("reports a loop once however many entry points reach it", () => {
    const graph: GraphSnapshot = {
      nodes: nodesFor(["task:a", "task:b", "task:entry"]),
      edges: edgesFor([
        ["task:a", "task:b"],
        ["task:b", "task:a"],
        ["task:entry", "task:a"],
      ]),
    };
    expect(findCycles(graph, ["DEPENDS_ON"])).toHaveLength(1);
  });

  it("finds nothing in an acyclic chain", () => {
    const graph: GraphSnapshot = {
      nodes: nodesFor(["task:a", "task:b", "task:c"]),
      edges: edgesFor([
        ["task:a", "task:b"],
        ["task:b", "task:c"],
      ]),
    };
    expect(findCycles(graph, ["DEPENDS_ON"])).toEqual([]);
  });

  it("ignores edge kinds it was not asked about", () => {
    const graph: GraphSnapshot = {
      nodes: nodesFor(["task:a", "task:b"]),
      edges: [
        ...edgesFor([["task:a", "task:b"]]),
        { id: "x", kind: "POWERS", from: "task:b", to: "task:a", origin: "DERIVED", confidence: 1 },
      ],
    };
    expect(findCycles(graph, ["DEPENDS_ON"])).toEqual([]);
  });
});
