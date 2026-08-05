import { describe, expect, it } from "vitest";
import { compilePartSpec, validatePartSpec, type PartSpec } from "@/lib/sim/part-spec";
import { buildModelIndex, findMcuPart } from "@/lib/sim/models";
import { normalizeCircuitDoc, type CircuitDoc } from "@/lib/circuit/catalog";
import type { PartContext } from "@/lib/sim/parts";

/** A context standing in for the engine, with the nets the test cares about. */
function context(levels: Record<string, 0 | 1 | null>, state: Record<string, unknown> = {}) {
  return {
    state,
    net: (pin: string) => ({ level: levels[pin] ?? null }),
  } as unknown as PartContext;
}

const button: PartSpec = {
  label: "Reed switch",
  pins: ["1", "2"],
  interactive: "momentary",
  shorts: [{ when: "toggled", pins: ["1", "2"] }],
};

describe("part specs", () => {
  it("drives a pin only while its condition holds", () => {
    const model = compilePartSpec({
      label: "Relay",
      pins: ["IN", "OUT"],
      drives: [
        { when: "always", pin: "OUT", drive: "float" },
        { when: "pin", is: "high", whenPin: "IN", pin: "OUT", drive: "high" },
      ],
    });

    expect(model.drive?.(context({ IN: 1 }), "OUT")).toBe("high");
    expect(model.drive?.(context({ IN: 0 }), "OUT")).toBe("float");
  });

  it("shorts pins only when toggled", () => {
    const model = compilePartSpec(button);
    expect(model.shorts?.(context({}, { pressed: true }))).toEqual([["1", "2"]]);
    expect(model.shorts?.(context({}, { pressed: false }))).toEqual([]);
  });

  it("lights an indicator on the LED convention", () => {
    const model = compilePartSpec({
      label: "Status lamp",
      pins: ["A", "K"],
      indicator: { high: "A", low: "K" },
    });
    expect(model.output?.(context({ A: 1, K: 0 }))).toBe(1);
    expect(model.output?.(context({ A: 1, K: 1 }))).toBe(0);
  });

  it("never drives from an MCU spec, because firmware does that", () => {
    const model = compilePartSpec({
      label: "Custom board",
      pins: ["D1"],
      mcu: true,
      drives: [{ when: "always", pin: "D1", drive: "high" }],
    });
    expect(model.drive).toBeUndefined();
  });

  it("rejects a spec whose rules reference pins it does not have", () => {
    const problems = validatePartSpec({
      label: "Broken",
      pins: ["A"],
      drives: [{ when: "always", pin: "B", drive: "high" }],
      shorts: [{ when: "always", pins: ["A", "C"] }],
    });
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toContain('"B"');
    expect(problems.join(" ")).toContain('"C"');
  });

  it("rejects a pin condition missing its level", () => {
    const problems = validatePartSpec({
      label: "Half a rule",
      pins: ["A", "B"],
      drives: [{ when: "pin", pin: "A", drive: "high" }],
    });
    expect(problems.join(" ")).toContain("needs both a whenPin and a level");
  });
});

describe("model index", () => {
  const doc = (models?: CircuitDoc["models"]): CircuitDoc =>
    normalizeCircuitDoc({
      version: 2,
      parts: [
        { id: "u1", type: "wokwi-arduino-uno", x: 0, y: 0 },
        { id: "s1", type: "acme-hall-sensor", label: "Hall", x: 100, y: 0 },
      ],
      wires: [{ id: "w1", from: { part: "u1", pin: "2" }, to: { part: "s1", pin: "OUT" } }],
      ...(models ? { models } : {}),
    });

  it("marks a part with no built-in model and no spec as unmodelled", () => {
    const index = buildModelIndex(doc());
    expect(index.unmodelled).toEqual(["acme-hall-sensor"]);
    // Inert, but wired: its pins come from the wires so neighbours still resolve.
    expect(index.of("acme-hall-sensor").pins).toEqual(["OUT"]);
    expect(index.of("acme-hall-sensor").label).toContain("UNMODELLED");
  });

  it("uses a document spec when the catalog has nothing", () => {
    const index = buildModelIndex(
      doc({
        "acme-hall-sensor": {
          label: "Hall sensor",
          pins: ["OUT"],
          drives: [{ when: "always", pin: "OUT", drive: "low" }],
        },
      }),
    );
    expect(index.unmodelled).toEqual([]);
    expect(index.of("acme-hall-sensor").drive?.(context({}), "OUT")).toBe("low");
  });

  it("finds an MCU declared by a spec, not just a built-in one", () => {
    const custom = normalizeCircuitDoc({
      version: 2,
      parts: [{ id: "b1", type: "acme-board", x: 0, y: 0 }],
      wires: [],
      models: { "acme-board": { label: "Acme board", pins: ["D1"], mcu: true } },
    });
    expect(findMcuPart(custom)?.id).toBe("b1");
  });

  it("keeps specs through document normalisation and drops unusable ones", () => {
    const normalised = normalizeCircuitDoc({
      version: 2,
      parts: [],
      wires: [],
      models: {
        good: { label: "Good", pins: ["A"] },
        bad: { label: "Bad", pins: ["A"], drives: [{ when: "always", pin: "Z", drive: "high" }] },
      },
    });
    expect(Object.keys(normalised.models ?? {})).toEqual(["good"]);
  });
});
