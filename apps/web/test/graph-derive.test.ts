/**
 * One test per derivation rule, asserting the exact tuple the rule produces.
 *
 * The rules are the graph's only source of truth about how artifacts relate,
 * and a rule that silently stops firing degrades impact analysis into a shorter
 * list with no error anywhere. So each is pinned to its refKeys, its edge kind,
 * its rule id and its confidence — the confidence especially, because that is
 * what separates a structural fact from a name guess downstream.
 */

import { describe, expect, it } from "vitest";
import { contentHashOf, deriveGraph, PASSIVE_PART_TYPES } from "@/lib/graph/derive";
import type { GraphInput } from "@/lib/graph/derive";
import { EMPTY_PCB } from "@/lib/pcb/doc";
import { AUTHORED_ONLY_EDGE_KINDS } from "@/lib/graph/types";
import { envMonitorInput } from "./fixtures/env-monitor";

const EMPTY: GraphInput = {
  circuit: null,
  pcb: null,
  codeFiles: [],
  components: [],
  cad: [],
  requirements: [],
  validationChecks: [],
};

const edgeFor = (result: ReturnType<typeof deriveGraph>, from: string, to: string) =>
  result.edges.find((e) => e.from === from && e.to === to);

describe("node derivation", () => {
  const { nodes } = deriveGraph(envMonitorInput);
  const byKey = new Map(nodes.map((n) => [n.refKey, n]));

  it.each([
    ["requirement:req-runtime", "REQUIREMENT", "derive:n:requirement"],
    ["component:cmp-battery", "COMPONENT", "derive:n:component"],
    ["check:chk-battery", "CHECK", "derive:n:check"],
    ["codefile:file-main", "FIRMWARE_FILE", "derive:n:firmware"],
    ["circuitpart:u1", "CIRCUIT_PART", "derive:n:circuit-part"],
    ["net:I2C_SDA", "NET", "derive:n:net"],
    ["pin:u1:D2", "MCU_PIN", "derive:n:mcu-pin"],
    ["cadpart:parts/enclosure.kcl", "CAD_PART", "derive:n:cad"],
    ["cadassembly:assembly/product.kcl", "CAD_ASSEMBLY", "derive:n:cad"],
  ])("derives %s as %s", (refKey, kind, originDetail) => {
    expect(byKey.get(refKey)).toMatchObject({ kind, origin: "DERIVED", originDetail });
  });

  it("points row-backed nodes at their row and leaves computed nodes without one", () => {
    expect(byKey.get("component:cmp-battery")?.refId).toBe("cmp-battery");
    expect(byKey.get("net:I2C_SDA")?.refId).toBeUndefined();
  });

  it("skips rows with no id, since nothing could address them", () => {
    const { nodes: none } = deriveGraph({
      ...EMPTY,
      requirements: [{ title: "unsaved", priority: "MUST" }],
    });
    expect(none).toHaveLength(0);
  });

  it("treats only firmware files as nodes", () => {
    expect(byKey.has("codefile:file-main")).toBe(true);
    const { nodes: docs } = deriveGraph({
      ...EMPTY,
      codeFiles: [{ id: "f1", path: "README.md", content: "# hi" }],
    });
    expect(docs).toHaveLength(0);
  });

  it("leaves power pins out, since everything is wired to them", () => {
    expect([...byKey.keys()].filter((k) => k.startsWith("pin:"))).toEqual([
      "pin:u1:D2",
      "pin:u1:A4",
    ]);
  });
});

describe("component to schematic part", () => {
  it("matches on reference designator at full confidence", () => {
    const result = deriveGraph(envMonitorInput);
    expect(edgeFor(result, "component:cmp-mcu", "circuitpart:u1")).toMatchObject({
      kind: "REALIZED_BY",
      rule: "refdes-match",
      confidence: 1,
    });
  });

  it("normalises case and whitespace around the designator", () => {
    const result = deriveGraph({
      ...envMonitorInput,
      components: [{ id: "c1", refDes: " u1 ", name: "Controller", discipline: "ELECTRONICS" }],
    });
    expect(edgeFor(result, "component:c1", "circuitpart:u1")?.rule).toBe("refdes-match");
  });

  it("falls back to a name match at reduced confidence when there is no designator", () => {
    const result = deriveGraph({
      ...envMonitorInput,
      components: [{ id: "c1", name: "resistor", discipline: "ELECTRONICS" }],
    });
    const edge = edgeFor(result, "component:c1", "circuitpart:r1");
    expect(edge).toMatchObject({ kind: "REALIZED_BY", rule: "name-match", confidence: 0.6 });
    expect(edge?.evidence).toContain("by name");
  });

  it("prefers the exact designator over the name guess", () => {
    const result = deriveGraph(envMonitorInput);
    const edges = result.edges.filter((e) => e.from === "component:cmp-mcu");
    expect(edges.every((e) => e.rule !== "name-match")).toBe(true);
  });
});

describe("nets, pins and firmware", () => {
  const result = deriveGraph(envMonitorInput);

  it("links a schematic part to every net it sits on", () => {
    expect(edgeFor(result, "circuitpart:u2", "net:I2C_SDA")).toMatchObject({
      kind: "CONNECTS",
      rule: "wire-net",
      confidence: 1,
    });
  });

  it("runs the net into the MCU pin, not the other way round", () => {
    expect(edgeFor(result, "net:I2C_SDA", "pin:u1:A4")).toMatchObject({
      kind: "CONNECTS",
      rule: "pin-net",
    });
    expect(edgeFor(result, "pin:u1:A4", "net:I2C_SDA")).toBeUndefined();
  });

  it("makes the firmware depend on the pin it was observed driving", () => {
    expect(edgeFor(result, "pin:u1:D2", "codefile:file-main")).toMatchObject({
      kind: "DRIVES",
      rule: "firmware-pin",
      confidence: 1,
    });
  });

  it("derives pin edges from the simulation run, not from the source text", () => {
    // src/main.cpp never mentions D2 or A4 in the fixture — the edges come
    // from what the simulator recorded, which is why a pin reached through a
    // variable or a helper is still caught.
    expect(envMonitorInput.codeFiles[0]!.content).not.toMatch(/D2|A4/);
    expect(edgeFor(result, "pin:u1:A4", "codefile:file-main")).toBeDefined();
  });

  it("derives no firmware edges when nothing was run", () => {
    const noRun = deriveGraph({ ...envMonitorInput, simulation: undefined });
    expect(noRun.edges.some((e) => e.rule === "firmware-pin")).toBe(false);
  });
});

describe("footprints", () => {
  it("links a schematic part to the footprint that realises it", () => {
    // Built from EMPTY_PCB so the fixture cannot drift from the real board
    // shape — a hand-written literal here would typecheck against nothing.
    const result = deriveGraph({
      ...envMonitorInput,
      pcb: {
        version: 2,
        boards: [
          {
            ...EMPTY_PCB,
            footprints: [
              {
                id: "fp1",
                libraryId: "R_0603",
                refDes: "R1",
                xMm: 10,
                yMm: 10,
                rotationDeg: 0,
                side: "front",
                partId: "r1",
              },
            ],
          },
        ],
      },
    });
    expect(edgeFor(result, "circuitpart:r1", "footprint:0:R1")).toMatchObject({
      kind: "REALIZED_BY",
      rule: "footprint-partid",
      confidence: 1,
    });
  });

  it("keys footprints by board index, so two boards can both carry an R1", () => {
    const result = deriveGraph({
      ...envMonitorInput,
      pcb: {
        version: 2,
        boards: [EMPTY_PCB, EMPTY_PCB].map((board) => ({
          ...board,
          footprints: [
            {
              id: "fp",
              libraryId: "R_0603",
              refDes: "R1",
              xMm: 0,
              yMm: 0,
              rotationDeg: 0,
              side: "front" as const,
            },
          ],
        })),
      },
    });
    const keys = result.nodes.filter((n) => n.kind === "FOOTPRINT").map((n) => n.refKey);
    expect(keys).toEqual(["footprint:0:R1", "footprint:1:R1"]);
  });
});

describe("CAD", () => {
  const result = deriveGraph(envMonitorInput);

  it("reads containment out of the assembly's KCL imports", () => {
    expect(
      edgeFor(result, "cadpart:parts/battery-bay.kcl", "cadassembly:assembly/product.kcl"),
    ).toMatchObject({ kind: "CONTAINS", rule: "cad-import", confidence: 1 });
  });

  it("guesses housing from a significant word, at half confidence", () => {
    const edge = edgeFor(result, "component:cmp-battery", "cadpart:parts/battery-bay.kcl");
    expect(edge).toMatchObject({ kind: "HOUSES", rule: "cad-houses", confidence: 0.5 });
    expect(edge?.evidence).toContain("battery");
  });

  it("does not let a generic word claim housing", () => {
    // "Arduino Nano controller" contains no word that appears in a CAD path,
    // and "module"-class words are blocked outright.
    expect(
      result.edges.filter((e) => e.from === "component:cmp-mcu" && e.kind === "HOUSES"),
    ).toHaveLength(0);
    const generic = deriveGraph({
      ...envMonitorInput,
      components: [{ id: "c1", name: "Sensor module board", discipline: "ELECTRONICS" }],
      cad: [{ path: "parts/module-board.kcl", name: "module board", kind: "part" }],
    });
    expect(generic.edges.filter((e) => e.kind === "HOUSES")).toHaveLength(0);
  });
});

describe("validation check targets", () => {
  const result = deriveGraph(envMonitorInput);

  it("resolves a target path to a CAD part", () => {
    expect(edgeFor(result, "cadpart:parts/enclosure.kcl", "check:chk-fit")).toMatchObject({
      kind: "VERIFIED_BY",
      rule: "check-targetpath",
      confidence: 1,
    });
  });

  it("resolves a target path to a reference designator", () => {
    expect(edgeFor(result, "component:cmp-battery", "check:chk-battery")).toMatchObject({
      rule: "check-targetpath",
      confidence: 1,
    });
  });

  it("resolves a target path to a code file", () => {
    const result2 = deriveGraph({
      ...envMonitorInput,
      validationChecks: [{ id: "c1", title: "Firmware review", targetPath: "src/main.cpp" }],
    });
    expect(edgeFor(result2, "codefile:file-main", "check:c1")?.rule).toBe("check-targetpath");
  });

  it("emits no edge at all when the target path resolves to nothing", () => {
    // Deliberate: the orphan is reported as a finding by checkOrphanTargets,
    // not papered over with a guess.
    const result2 = deriveGraph({
      ...envMonitorInput,
      validationChecks: [{ id: "c1", title: "Ghost", targetPath: "parts/deleted.kcl" }],
    });
    expect(result2.edges.some((e) => e.to === "check:c1")).toBe(false);
  });

  it("falls back to title overlap only where no target path claimed the check", () => {
    const result2 = deriveGraph({
      ...EMPTY,
      requirements: [{ id: "r1", title: "Enclosure survives a one metre drop", priority: "MUST" }],
      validationChecks: [{ id: "c1", title: "Drop test: enclosure from one metre" }],
    });
    expect(edgeFor(result2, "requirement:r1", "check:c1")).toMatchObject({
      rule: "check-title-match",
      confidence: 0.5,
    });
  });

  it("trusts a stated verification method over wording", () => {
    const result2 = deriveGraph({
      ...EMPTY,
      requirements: [
        { id: "r1", title: "Runs for 8 hours", priority: "MUST", verificationMethod: "Bench soak" },
      ],
      validationChecks: [{ id: "c1", title: "Bench soak" }],
    });
    expect(edgeFor(result2, "requirement:r1", "check:c1")).toMatchObject({
      rule: "req-verification-method",
      confidence: 0.7,
    });
  });
});

describe("power", () => {
  it("links every source to every known load", () => {
    const result = deriveGraph(envMonitorInput);
    const powers = result.edges.filter((e) => e.kind === "POWERS");
    expect(powers.map((e) => e.to).sort()).toEqual([
      "component:cmp-led",
      "component:cmp-mcu",
      "component:cmp-sensor",
    ]);
    expect(powers.every((e) => e.from === "component:cmp-battery" && e.confidence === 1)).toBe(
      true,
    );
  });

  it("does not treat a part with no stated draw as a load", () => {
    const result = deriveGraph(envMonitorInput);
    expect(result.edges.some((e) => e.to === "component:cmp-resistor")).toBe(false);
  });
});

describe("what the deriver refuses to do", () => {
  it("never invents an edge that encodes engineering judgement", () => {
    const { edges } = deriveGraph(envMonitorInput);
    for (const kind of AUTHORED_ONLY_EDGE_KINDS) {
      expect(edges.filter((e) => e.kind === kind)).toHaveLength(0);
    }
  });

  it("marks everything it does produce as DERIVED", () => {
    const { nodes, edges } = deriveGraph(envMonitorInput);
    expect(nodes.every((n) => n.origin === "DERIVED")).toBe(true);
    expect(edges.every((e) => e.origin === "DERIVED")).toBe(true);
  });
});

describe("determinism and de-duplication", () => {
  it("produces the same graph twice", () => {
    expect(deriveGraph(envMonitorInput)).toEqual(deriveGraph(envMonitorInput));
  });

  it("emits one node per refKey and one edge per (from, to, kind)", () => {
    const { nodes, edges } = deriveGraph(envMonitorInput);
    expect(new Set(nodes.map((n) => n.refKey)).size).toBe(nodes.length);
    expect(new Set(edges.map((e) => `${e.from}|${e.to}|${e.kind}`)).size).toBe(edges.length);
  });

  it("keeps the more confident edge when two rules produce the same link", () => {
    // A component that both carries R1 and is named "resistor": refdes-match
    // and name-match both fire, and the structural one must survive.
    const result = deriveGraph({
      ...envMonitorInput,
      components: [{ id: "c1", refDes: "R1", name: "resistor", discipline: "ELECTRONICS" }],
    });
    expect(edgeFor(result, "component:c1", "circuitpart:r1")?.confidence).toBe(1);
  });
});

describe("contentHashOf", () => {
  it("is stable for the same content and differs for a change", () => {
    expect(contentHashOf("abc")).toBe(contentHashOf("abc"));
    expect(contentHashOf("abc")).not.toBe(contentHashOf("abd"));
  });

  it("handles empty content", () => {
    expect(contentHashOf("")).toEqual(expect.any(String));
  });
});

describe("PASSIVE_PART_TYPES", () => {
  it("covers the parts that legitimately have no driver", () => {
    for (const type of ["wokwi-resistor", "wokwi-capacitor", "wokwi-led", "wokwi-pushbutton"]) {
      expect(PASSIVE_PART_TYPES.has(type)).toBe(true);
    }
    expect(PASSIVE_PART_TYPES.has("wokwi-arduino-nano")).toBe(false);
  });
});
