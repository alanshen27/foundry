/**
 * Each graph-backed check, against a clean project and a defective one.
 *
 * Both halves matter. A check that never fires passes every clean fixture and
 * is worthless; a check that always fires trains people to ignore the panel.
 * So every describe here asserts that the finding appears on the defect AND
 * that it stays quiet on the clean case.
 */

import { describe, expect, it } from "vitest";
import {
  checkComponentSoftware,
  checkLifecycleRisk,
  checkOrphanTargets,
  checkPowerBudget,
  checkRequirementCoverage,
  checkStaleDownstream,
  checkTaskDependencies,
  type GraphCheckInput,
} from "@/lib/graph/checks";
import { deriveGraph, type GraphInput } from "@/lib/graph/derive";
import type { GraphEdge, GraphNode, GraphSnapshot } from "@/lib/graph/types";
import { authoredEdges, envMonitorInput } from "./fixtures/env-monitor";

const EMPTY_INPUT: GraphInput = {
  circuit: null,
  pcb: null,
  codeFiles: [],
  components: [],
  cad: [],
  requirements: [],
  validationChecks: [],
};

/** Derives the graph for an input and returns it as a check-ready snapshot. */
function scope(input: GraphInput, extraEdges: GraphEdge[] = []): GraphCheckInput {
  const derived = deriveGraph(input);
  const graph: GraphSnapshot = {
    nodes: derived.nodes.map((n, i) => ({ ...n, id: `n${i}` })),
    edges: [...derived.edges.map((e, i) => ({ ...e, id: `e${i}` })), ...extraEdges],
  };
  return { ...input, graph };
}

const messages = (findings: { message: string }[]) => findings.map((f) => f.message).join(" | ");

describe("checkRequirementCoverage", () => {
  it("errors on a MUST requirement nothing verifies, and names it", () => {
    const findings = checkRequirementCoverage(
      scope({
        ...EMPTY_INPUT,
        requirements: [{ id: "r1", title: "Survives a one metre drop", priority: "MUST" }],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "error" });
    expect(findings[0]!.message).toContain("Survives a one metre drop");
    // The finding links to the requirement, so the panel can jump to it.
    expect(findings[0]!.nodes).toEqual([
      { refKey: "requirement:r1", label: "Survives a one metre drop" },
    ]);
  });

  it("only warns for a SHOULD", () => {
    const findings = checkRequirementCoverage(
      scope({
        ...EMPTY_INPUT,
        requirements: [{ id: "r1", title: "Runs quietly", priority: "SHOULD" }],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warning");
  });

  it("says nothing about a MAY", () => {
    expect(
      checkRequirementCoverage(
        scope({
          ...EMPTY_INPUT,
          requirements: [{ id: "r1", title: "Could be blue", priority: "MAY" }],
        }),
      ),
    ).toEqual([]);
  });

  it("stays quiet when a check targets the requirement", () => {
    expect(
      checkRequirementCoverage(
        scope({
          ...EMPTY_INPUT,
          requirements: [
            { id: "r1", title: "Runs for 8 hours", priority: "MUST", verificationMethod: "Soak" },
          ],
          validationChecks: [{ id: "c1", title: "Soak" }],
        }),
      ),
    ).toEqual([]);
  });

  it("reports one finding for several uncovered MUSTs rather than one each", () => {
    const findings = checkRequirementCoverage(
      scope({
        ...EMPTY_INPUT,
        requirements: [
          { id: "r1", title: "A", priority: "MUST" },
          { id: "r2", title: "B", priority: "MUST" },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("2 MUST requirements");
    expect(findings[0]!.nodes).toHaveLength(2);
  });
});

describe("checkPowerBudget", () => {
  const withPower = (
    capacityMah: number,
    loads: number[],
    requirementHours: number | null,
  ): GraphInput => ({
    ...EMPTY_INPUT,
    components: [
      {
        id: "bat",
        refDes: "BT1",
        name: "Cell",
        discipline: "ELECTRONICS",
        capacityMah,
      },
      ...loads.map((currentDrawMa, i) => ({
        id: `load${i}`,
        refDes: `U${i + 1}`,
        name: `Load ${i + 1}`,
        discipline: "ELECTRONICS",
        currentDrawMa,
      })),
    ],
    requirements:
      requirementHours === null
        ? []
        : [
            {
              id: "req-time",
              title: "Operating time",
              priority: "MUST",
              minValue: requirementHours,
              unit: "h",
            },
          ],
  });

  it("errors when the estimated runtime falls short, showing the arithmetic", () => {
    // 2000 mAh / 250 mA = 8.0 h against a 10 h MUST.
    const findings = checkPowerBudget(scope(withPower(2000, [250], 10)));
    const error = findings.find((f) => f.severity === "error");
    expect(error).toBeDefined();
    expect(error!.message).toContain("8.0 h");
    expect(error!.message).toContain("2000 mAh");
    expect(error!.message).toContain("250.0 mA");
    expect(error!.message).toContain("10 h");
  });

  it("labels the number ESTIMATED, never verified", () => {
    const findings = checkPowerBudget(scope(withPower(2000, [250], 10)));
    expect(messages(findings)).toContain("ESTIMATED");
    expect(messages(findings).toLowerCase()).not.toContain("verified");
  });

  it("passes cleanly with headroom", () => {
    // 2000 / 250 = 8.0 h against a 6 h requirement — comfortably over 1.2x.
    expect(checkPowerBudget(scope(withPower(2000, [250], 6)))).toEqual([]);
  });

  it("warns when it only just clears the requirement", () => {
    // 8.0 h against 7 h: passes, but under the 1.2x headroom band.
    const findings = checkPowerBudget(scope(withPower(2000, [250], 7)));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "warning" });
    expect(findings[0]!.message).toContain("headroom");
  });

  it("sums several loads and scales by quantity", () => {
    const input = withPower(2000, [100, 100], 10);
    input.components[1]!.quantity = 2; // 100 x 2 + 100 = 300 mA
    const findings = checkPowerBudget(scope(input));
    expect(findings.find((f) => f.severity === "error")!.message).toContain("300.0 mA");
  });

  it("warns rather than passing silently when nothing states an operating time", () => {
    // A check with nothing to compare against must say so; silence reads as a
    // pass, which is the one thing it must not imply.
    const findings = checkPowerBudget(scope(withPower(2000, [250], null)));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("no requirement states an operating time");
  });

  it("flags an incomplete budget instead of flattering itself", () => {
    const input = withPower(2000, [250], 6);
    input.components.push({
      id: "unknown",
      refDes: "U9",
      name: "Radio",
      discipline: "ELECTRONICS",
    });
    const findings = checkPowerBudget(scope(input));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("incomplete");
    expect(findings[0]!.message).toContain("optimistic");
  });

  it("says nothing when there is no source or no load", () => {
    expect(checkPowerBudget(scope(withPower(2000, [], 8)))).toEqual([]);
    expect(
      checkPowerBudget(
        scope({
          ...EMPTY_INPUT,
          components: [{ id: "l", name: "Load", discipline: "ELECTRONICS", currentDrawMa: 10 }],
        }),
      ),
    ).toEqual([]);
  });
});

describe("checkComponentSoftware", () => {
  it("stays quiet about passives", () => {
    const findings = checkComponentSoftware(
      scope({
        ...EMPTY_INPUT,
        circuit: {
          version: 2,
          groups: [],
          parts: [{ id: "r1", type: "wokwi-resistor", label: "R1", x: 0, y: 0 }],
          wires: [],
        },
        components: [{ id: "c1", refDes: "R1", name: "220R resistor", discipline: "ELECTRONICS" }],
      }),
    );
    expect(findings).toEqual([]);
  });

  it("flags an active part nothing drives", () => {
    const findings = checkComponentSoftware(
      scope({
        ...EMPTY_INPUT,
        circuit: {
          version: 2,
          groups: [],
          parts: [{ id: "u2", type: "wokwi-bme680", label: "U2", x: 0, y: 0 }],
          wires: [],
        },
        components: [{ id: "c1", refDes: "U2", name: "BME680 sensor", discipline: "ELECTRONICS" }],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warning");
  });

  it("never escalates to an error, because it can be wrong", () => {
    const findings = checkComponentSoftware(
      scope({
        ...EMPTY_INPUT,
        components: [{ id: "c1", name: "Mystery chip", discipline: "ELECTRONICS" }],
      }),
    );
    expect(findings.every((f) => f.severity !== "error")).toBe(true);
  });

  it("ignores non-electronic BOM lines", () => {
    expect(
      checkComponentSoftware(
        scope({
          ...EMPTY_INPUT,
          components: [{ id: "c1", name: "M3 screw", discipline: "MECHANICAL" }],
        }),
      ),
    ).toEqual([]);
  });
});

describe("checkComponentSoftware reachability", () => {
  // Regression: an earlier version of this check asked the question backwards
  // and reported every part as undriven, including the microcontroller the
  // firmware demonstrably runs on. Edges flow component -> schematic part ->
  // net -> pin -> firmware, so the walk is forward.
  const scoped = scope(
    envMonitorInput,
    authoredEdges.map((e, i) => ({ ...e, id: `a${i}`, rule: null }) as GraphEdge),
  );

  it("does not flag the MCU whose pins the firmware drives", () => {
    expect(messages(checkComponentSoftware(scoped))).not.toContain("Arduino Nano");
  });

  it("flags a part whose pin the firmware never touches", () => {
    // Same schematic, but the simulation only exercised the LED line — so the
    // sensor on I2C_SDA is wired up and read by nothing.
    const ledOnly = scope({
      ...envMonitorInput,
      simulation: {
        ...envMonitorInput.simulation!,
        pinsExercised: ["D2"],
      } as typeof envMonitorInput.simulation,
    });
    const text = messages(checkComponentSoftware(ledOnly));
    expect(text).toContain("BME680");
    // …and still not the MCU, which drives the LED line.
    expect(text).not.toContain("Arduino Nano");
  });

  it("stays quiet when the firmware touches every active part", () => {
    expect(checkComponentSoftware(scoped)).toEqual([]);
  });

  it("does not flag the passive resistor or the battery", () => {
    const text = messages(checkComponentSoftware(scoped));
    expect(text).not.toContain("resistor");
    expect(text).not.toContain("Battery");
  });
});

describe("checkTaskDependencies", () => {
  const task = (id: string, status = "todo"): GraphNode => ({
    id,
    kind: "TASK",
    refKey: `task:${id}`,
    label: id.toUpperCase(),
    data: { status },
    origin: "AGENT",
  });
  const dependsOn = (from: string, to: string): GraphEdge => ({
    id: `${from}-${to}`,
    kind: "DEPENDS_ON",
    from: `task:${from}`,
    to: `task:${to}`,
    origin: "AGENT",
    confidence: 1,
  });
  const withTasks = (nodes: GraphNode[], edges: GraphEdge[]): GraphCheckInput => ({
    ...EMPTY_INPUT,
    graph: { nodes, edges },
  });

  it("names the tasks in a cycle, in order", () => {
    const findings = checkTaskDependencies(
      withTasks(
        [task("a"), task("b"), task("c")],
        [dependsOn("a", "b"), dependsOn("b", "c"), dependsOn("c", "a")],
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "error" });
    expect(findings[0]!.message).toContain("A -> B -> C -> A");
  });

  it("finds no cycle in a straight chain", () => {
    expect(checkTaskDependencies(withTasks([task("a"), task("b")], [dependsOn("a", "b")]))).toEqual(
      [],
    );
  });

  it("warns when a task is done before its prerequisite", () => {
    const findings = checkTaskDependencies(
      withTasks([task("a", "todo"), task("b", "done")], [dependsOn("a", "b")]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "warning" });
    expect(findings[0]!.message).toContain("prerequisite");
  });

  it("is happy when both are done", () => {
    expect(
      checkTaskDependencies(
        withTasks([task("a", "done"), task("b", "done")], [dependsOn("a", "b")]),
      ),
    ).toEqual([]);
  });
});

describe("checkStaleDownstream", () => {
  const staleNode = (overrides: Partial<GraphNode>): GraphNode => ({
    id: "n1",
    kind: "REQUIREMENT",
    refKey: "requirement:r1",
    label: "Operating time",
    origin: "DERIVED",
    staleAt: new Date("2026-09-01"),
    staleReason: "is satisfied by BT1",
    contentHash: "aaa",
    staleContentHash: "aaa",
    reviewedAt: null,
    ...overrides,
  });
  const only = (node: GraphNode): GraphCheckInput => ({
    ...EMPTY_INPUT,
    graph: { nodes: [node], edges: [] },
  });

  it("flags an artifact that was marked and never touched", () => {
    const findings = checkStaleDownstream(only(staleNode({})));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("Operating time");
    expect(findings[0]!.message).toContain("never revised");
  });

  it("stays quiet once the content has actually changed", () => {
    // The hash moved, so someone did revise it — which is the whole point of
    // recording the hash at the moment of flagging.
    expect(checkStaleDownstream(only(staleNode({ contentHash: "bbb" })))).toEqual([]);
  });

  it("stays quiet once it has been explicitly reviewed", () => {
    expect(checkStaleDownstream(only(staleNode({ reviewedAt: new Date("2026-09-02") })))).toEqual(
      [],
    );
  });

  it("stays quiet when nothing is stale", () => {
    expect(checkStaleDownstream(only(staleNode({ staleAt: null })))).toEqual([]);
  });
});

describe("checkOrphanTargets", () => {
  it("flags a check aimed at a path nothing matches", () => {
    const findings = checkOrphanTargets(
      scope({
        ...envMonitorInput,
        validationChecks: [{ id: "c1", title: "Ghost", targetPath: "parts/deleted.kcl" }],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("parts/deleted.kcl");
  });

  it("stays quiet when every target resolves", () => {
    expect(checkOrphanTargets(scope(envMonitorInput))).toEqual([]);
  });

  it("ignores checks with no target at all", () => {
    expect(
      checkOrphanTargets(
        scope({ ...EMPTY_INPUT, validationChecks: [{ id: "c1", title: "Manual review" }] }),
      ),
    ).toEqual([]);
  });
});

describe("the environmental monitor as a whole", () => {
  const scoped = scope(
    envMonitorInput,
    authoredEdges.map((e, i) => ({ ...e, id: `a${i}`, rule: null }) as GraphEdge),
  );

  it("reports the MUST nobody verifies and clears the one that names its method", () => {
    const findings = checkRequirementCoverage(scoped);
    // Coverage is NOT transitive through SATISFIES: chk-battery targets BT1,
    // so it verifies the cell, not the requirement the cell was chosen for.
    // req-runtime is covered only because it names its verification method.
    expect(messages(findings)).toContain("Reports temperature");
    expect(messages(findings)).not.toContain("Operating time");
  });

  it("finds the runtime comfortable but the budget incomplete", () => {
    // 2000 mAh / 31 mA is about 64 h against an 8 h requirement, so the only
    // honest complaint is the resistor with no stated draw.
    const findings = checkPowerBudget(scoped);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("incomplete");
  });
});

describe("checkLifecycleRisk", () => {
  // Ids chosen because @foundry/sourcing's deterministic hash puts them in
  // the scenario named: EOL with no substitute, EOL with a substitute known,
  // and comfortably ACTIVE. See seeded.ts's lifecycleStatusOf/hasSubstituteOf.
  const withComponent = (id: string): GraphInput => ({
    ...EMPTY_INPUT,
    components: [{ id, name: "Test part", discipline: "ELECTRONICS" }],
  });

  it("warns on an EOL part with no known substitute, and names it", () => {
    const findings = checkLifecycleRisk(scope(withComponent("cmp-lifecycle-40")));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warning");
    expect(findings[0]!.message).toContain("end-of-life");
    expect(findings[0]!.nodes).toEqual([
      expect.objectContaining({ refKey: "component:cmp-lifecycle-40" }),
    ]);
  });

  it("stays quiet on an EOL part that has a substitute lined up", () => {
    expect(checkLifecycleRisk(scope(withComponent("cmp-lifecycle-41")))).toEqual([]);
  });

  it("stays quiet on an ACTIVE part", () => {
    expect(checkLifecycleRisk(scope(withComponent("cmp-lifecycle-0")))).toEqual([]);
  });

  it("keys by partNumber over id when both are present", () => {
    // cmp-lifecycle-40 is EOL-with-no-substitute; if the check used the id
    // instead of the MPN it would see "some-other-id" and stay quiet.
    const input: GraphInput = {
      ...EMPTY_INPUT,
      components: [
        {
          id: "some-other-id",
          name: "Test part",
          discipline: "ELECTRONICS",
          partNumber: "cmp-lifecycle-40",
        },
      ],
    };
    const findings = checkLifecycleRisk(scope(input));
    expect(findings).toHaveLength(1);
  });
});
