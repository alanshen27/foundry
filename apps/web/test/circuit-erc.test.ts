import { describe, expect, it } from "vitest";
import { runCircuitErc } from "@/lib/circuit/erc";
import type { CircuitDoc } from "@/lib/circuit/catalog";

function doc(wires: CircuitDoc["wires"]): CircuitDoc {
  return {
    version: 2,
    parts: [
      { id: "u1", type: "generic:IC", label: "U1", x: 0, y: 0 },
      { id: "r1", type: "wokwi-resistor", label: "R1", x: 100, y: 0 },
      { id: "led1", type: "wokwi-led", label: "LED1", x: 200, y: 0 },
    ],
    wires,
    groups: [],
  };
}

describe("runCircuitErc", () => {
  it("reports invalid endpoints, duplicate wires, and unconnected parts", () => {
    const issues = runCircuitErc(
      doc([
        {
          id: "w1",
          from: { part: "u1", pin: "1" },
          to: { part: "r1", pin: "1" },
        },
        {
          id: "w2",
          from: { part: "r1", pin: "1" },
          to: { part: "u1", pin: "1" },
        },
        {
          id: "w3",
          from: { part: "missing", pin: "1" },
          to: { part: "u1", pin: "2" },
        },
      ]),
    );
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["duplicate_wire", "missing_part", "unconnected_part"]),
    );
  });

  it("detects conflicting labels on one connected net", () => {
    const issues = runCircuitErc(
      doc([
        {
          id: "w1",
          from: { part: "u1", pin: "1" },
          to: { part: "r1", pin: "1" },
          label: "SDA",
        },
        {
          id: "w2",
          from: { part: "r1", pin: "1" },
          to: { part: "led1", pin: "A" },
          label: "SCL",
        },
      ]),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "conflicting_net_label", severity: "error" }),
    );
  });

  it("rejects duplicate reference designators", () => {
    const schematic = doc([]);
    schematic.parts[2]!.label = "r1";
    const issues = runCircuitErc(schematic);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "duplicate_reference",
        severity: "error",
        partId: "led1",
      }),
    );
  });

  it("does not count a wire with a missing pin as a connected part", () => {
    const issues = runCircuitErc(
      doc([
        {
          id: "w1",
          from: { part: "u1", pin: "" },
          to: { part: "r1", pin: "1" },
        },
      ]),
    );
    const unconnected = issues
      .filter((issue) => issue.code === "unconnected_part")
      .map((issue) => issue.partId);

    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_pin", wireId: "w1" }));
    expect(unconnected).toEqual(expect.arrayContaining(["u1", "r1"]));
  });

  it("accepts one named net without errors", () => {
    const issues = runCircuitErc(
      doc([
        {
          id: "w1",
          from: { part: "u1", pin: "1" },
          to: { part: "r1", pin: "1" },
          label: "SDA",
        },
        {
          id: "w2",
          from: { part: "r1", pin: "1" },
          to: { part: "led1", pin: "A" },
          label: "SDA",
        },
      ]),
    );
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });
});
