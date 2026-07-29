import { describe, expect, it } from "vitest";
import type { CircuitDoc } from "@/lib/circuit/catalog";
import { normalizePcbDoc, type PcbDoc } from "@/lib/pcb/doc";
import {
  buildNets,
  buildRatsnest,
  netsByPad,
  padWorldPosition,
  resolvePad,
} from "@/lib/pcb/netlist";

function circuit(partial: Partial<CircuitDoc> = {}): CircuitDoc {
  return { version: 2, parts: [], wires: [], groups: [], ...partial };
}

/** Two resistors in series off a 5V rail — the smallest useful netlist. */
function dividerCircuit(): CircuitDoc {
  return circuit({
    parts: [
      { id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
      { id: "r1", type: "wokwi-resistor", label: "R1", x: 200, y: 0 },
      { id: "r2", type: "wokwi-resistor", label: "R2", x: 400, y: 0 },
    ],
    wires: [
      { id: "w1", from: { part: "uno", pin: "5V" }, to: { part: "r1", pin: "1" } },
      { id: "w2", from: { part: "r1", pin: "2" }, to: { part: "r2", pin: "1" } },
      { id: "w3", from: { part: "r2", pin: "2" }, to: { part: "uno", pin: "GND.1" } },
    ],
  });
}

function board(footprints: PcbDoc["footprints"]): PcbDoc {
  return normalizePcbDoc({
    board: { widthMm: 80, heightMm: 50, thicknessMm: 1.6, cornerRadiusMm: 1 },
    footprints,
  });
}

describe("buildNets", () => {
  it("uses a schematic net label instead of a generated name", () => {
    const named = dividerCircuit();
    named.wires[0]!.label = "SENSE";
    expect(buildNets(named)[0]?.name).toBe("SENSE");
  });

  it("finds one net per wired pin pair", () => {
    const nets = buildNets(dividerCircuit());
    expect(nets).toHaveLength(3);
    expect(nets.flatMap((n) => n.nodes)).toHaveLength(6);
  });

  it("merges pins joined transitively into a single net", () => {
    const nets = buildNets(
      circuit({
        wires: [
          { id: "w1", from: { part: "a", pin: "1" }, to: { part: "b", pin: "1" } },
          { id: "w2", from: { part: "b", pin: "1" }, to: { part: "c", pin: "1" } },
          { id: "w3", from: { part: "c", pin: "1" }, to: { part: "d", pin: "1" } },
        ],
      }),
    );
    expect(nets).toHaveLength(1);
    expect(nets[0]?.nodes.map((n) => n.partId).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("names power and ground rails, and numbers the rest", () => {
    const nets = buildNets(dividerCircuit());
    const names = nets.map((n) => n.name);
    expect(names).toContain("5V");
    expect(names).toContain("GND");
    expect(names).toContain("N$1");
  });

  it("treats distinct pins on the same part as distinct nodes", () => {
    const nets = buildNets(
      circuit({
        wires: [
          { id: "w1", from: { part: "r1", pin: "1" }, to: { part: "r2", pin: "1" } },
          { id: "w2", from: { part: "r1", pin: "2" }, to: { part: "r3", pin: "1" } },
        ],
      }),
    );
    expect(nets).toHaveLength(2);
  });

  it("returns no nets for a schematic with no wires", () => {
    expect(
      buildNets(circuit({ parts: [{ id: "r1", type: "wokwi-resistor", x: 0, y: 0 }] })),
    ).toEqual([]);
  });
});

describe("padWorldPosition", () => {
  const pad = { xMm: 2, yMm: 0 };

  it("offsets by the footprint origin when unrotated", () => {
    expect(padWorldPosition({ xMm: 10, yMm: 20, rotationDeg: 0 }, pad)).toEqual({
      xMm: 12,
      yMm: 20,
    });
  });

  it("rotates clockwise with +Y down, matching the canvas transform", () => {
    const at = padWorldPosition({ xMm: 10, yMm: 20, rotationDeg: 90 }, pad);
    expect(at.xMm).toBeCloseTo(10, 6);
    expect(at.yMm).toBeCloseTo(22, 6);
  });

  it("mirrors the pad through the origin at 180 degrees", () => {
    const at = padWorldPosition({ xMm: 10, yMm: 20, rotationDeg: 180 }, pad);
    expect(at.xMm).toBeCloseTo(8, 6);
    expect(at.yMm).toBeCloseTo(20, 6);
  });
});

describe("resolvePad", () => {
  const fp = {
    id: "f1",
    libraryId: "LED_0805",
    refDes: "D1",
    xMm: 0,
    yMm: 0,
    rotationDeg: 0,
    side: "front" as const,
  };

  it("prefers an explicit pinMap entry", () => {
    expect(resolvePad({ ...fp, pinMap: { A: "1", C: "2" } }, "A")?.pin).toBe("1");
    expect(resolvePad({ ...fp, pinMap: { A: "1", C: "2" } }, "C")?.pin).toBe("2");
  });

  it("falls back to a direct pad-name match", () => {
    expect(resolvePad(fp, "2")?.pin).toBe("2");
  });

  it("returns undefined when the pin names nothing on the footprint", () => {
    expect(resolvePad(fp, "A")).toBeUndefined();
  });
});

describe("buildRatsnest", () => {
  /** The divider board: every schematic part linked to a footprint. */
  function linkedBoard() {
    return board([
      {
        id: "f_u1",
        libraryId: "SOIC-8",
        refDes: "U1",
        xMm: 20,
        yMm: 25,
        rotationDeg: 0,
        side: "front",
        partId: "uno",
        pinMap: { "5V": "1", "GND.1": "8" },
      },
      {
        id: "f_r1",
        libraryId: "R_0603",
        refDes: "R1",
        xMm: 40,
        yMm: 25,
        rotationDeg: 0,
        side: "front",
        partId: "r1",
      },
      {
        id: "f_r2",
        libraryId: "R_0603",
        refDes: "R2",
        xMm: 60,
        yMm: 25,
        rotationDeg: 0,
        side: "front",
        partId: "r2",
      },
    ]);
  }

  it("draws one airwire fewer than the pads on each net", () => {
    const { nets, airwires, issues } = buildRatsnest(dividerCircuit(), linkedBoard());
    expect(nets).toHaveLength(3);
    // Every net here has exactly two resolved pads.
    expect(airwires).toHaveLength(3);
    expect(issues.unlinkedParts).toEqual([]);
    expect(issues.unmappedPins).toEqual([]);
    expect(issues.danglingFootprints).toEqual([]);
  });

  it("anchors airwires to real pad positions", () => {
    const { airwires } = buildRatsnest(dividerCircuit(), linkedBoard());
    const middle = airwires.find((a) => a.net === "N$1");
    // R1 pad 2 at 40 + 0.75, R2 pad 1 at 60 - 0.75.
    const xs = [middle?.from.xMm, middle?.to.xMm].sort();
    expect(xs).toEqual([40.75, 59.25]);
  });

  it("spans a three-pad net with two airwires", () => {
    const threeWay = circuit({
      parts: [
        { id: "r1", type: "wokwi-resistor", x: 0, y: 0 },
        { id: "r2", type: "wokwi-resistor", x: 0, y: 0 },
        { id: "r3", type: "wokwi-resistor", x: 0, y: 0 },
      ],
      wires: [
        { id: "w1", from: { part: "r1", pin: "1" }, to: { part: "r2", pin: "1" } },
        { id: "w2", from: { part: "r2", pin: "1" }, to: { part: "r3", pin: "1" } },
      ],
    });
    const pcb = board(
      ["r1", "r2", "r3"].map((partId, i) => ({
        id: `f_${partId}`,
        libraryId: "R_0603",
        refDes: `R${i + 1}`,
        xMm: 10 + i * 10,
        yMm: 25,
        rotationDeg: 0,
        side: "front" as const,
        partId,
      })),
    );
    const { airwires } = buildRatsnest(threeWay, pcb);
    expect(airwires).toHaveLength(2);
  });

  it("connects nearest pads first rather than starring from one pad", () => {
    // Three collinear pads 10mm apart: an MST links 1-2 and 2-3, never 1-3.
    const chain = circuit({
      parts: ["a", "b", "c"].map((id) => ({ id, type: "wokwi-resistor", x: 0, y: 0 })),
      wires: [
        { id: "w1", from: { part: "a", pin: "1" }, to: { part: "b", pin: "1" } },
        { id: "w2", from: { part: "b", pin: "1" }, to: { part: "c", pin: "1" } },
      ],
    });
    const pcb = board(
      ["a", "b", "c"].map((partId, i) => ({
        id: `f_${partId}`,
        libraryId: "R_0603",
        refDes: `R${i + 1}`,
        xMm: 10 + i * 10,
        yMm: 25,
        rotationDeg: 0,
        side: "front" as const,
        partId,
      })),
    );
    const { airwires } = buildRatsnest(chain, pcb);
    const spans = airwires.map((a) => Math.abs(a.from.xMm - a.to.xMm));
    expect(spans.every((s) => s < 15)).toBe(true);
  });

  it("reports schematic parts that have no footprint", () => {
    const pcb = board([
      {
        id: "f_r1",
        libraryId: "R_0603",
        refDes: "R1",
        xMm: 40,
        yMm: 25,
        rotationDeg: 0,
        side: "front",
        partId: "r1",
      },
    ]);
    const { issues, airwires } = buildRatsnest(dividerCircuit(), pcb);
    expect(issues.unlinkedParts.map((p) => p.partId).sort()).toEqual(["r2", "uno"]);
    // Only R1 is placed, so no net has two pads to span.
    expect(airwires).toEqual([]);
  });

  it("reports wired pins with no matching pad", () => {
    const pcb = board([
      {
        id: "f_u1",
        libraryId: "SOIC-8",
        refDes: "U1",
        xMm: 20,
        yMm: 25,
        rotationDeg: 0,
        side: "front",
        // No pinMap, so "5V" and "GND.1" match no SOIC-8 pad.
        partId: "uno",
      },
    ]);
    const { issues } = buildRatsnest(dividerCircuit(), pcb);
    expect(issues.unmappedPins.map((p) => p.pin).sort()).toEqual(["5V", "GND.1"]);
    expect(issues.unmappedPins.every((p) => p.refDes === "U1")).toBe(true);
  });

  it("reports footprints pointing at a part the schematic no longer has", () => {
    const pcb = board([
      {
        id: "f_x",
        libraryId: "R_0603",
        refDes: "R9",
        xMm: 10,
        yMm: 10,
        rotationDeg: 0,
        side: "front",
        partId: "deleted-part",
      },
    ]);
    const { issues } = buildRatsnest(dividerCircuit(), pcb);
    expect(issues.danglingFootprints).toEqual([{ refDes: "R9", partId: "deleted-part" }]);
  });

  it("reports a duplicate claim on the same schematic part", () => {
    const pcb = board(
      ["f_a", "f_b"].map((id, i) => ({
        id,
        libraryId: "R_0603",
        refDes: `R${i + 1}`,
        xMm: 10 + i * 10,
        yMm: 10,
        rotationDeg: 0,
        side: "front" as const,
        partId: "r1",
      })),
    );
    const { issues } = buildRatsnest(dividerCircuit(), pcb);
    expect(issues.danglingFootprints).toEqual([{ refDes: "R2", partId: "r1" }]);
  });

  it("ignores footprints with no schematic link", () => {
    const pcb = board([
      {
        id: "f_h1",
        libraryId: "MountingHole_3.2mm",
        refDes: "H1",
        xMm: 5,
        yMm: 5,
        rotationDeg: 0,
        side: "front",
      },
    ]);
    const { issues } = buildRatsnest(circuit(), pcb);
    expect(issues.danglingFootprints).toEqual([]);
    expect(issues.unmappedPins).toEqual([]);
  });
});

describe("netsByPad", () => {
  it("labels each resolved pad with its net", () => {
    const pcb = board([
      {
        id: "f_r1",
        libraryId: "R_0603",
        refDes: "R1",
        xMm: 40,
        yMm: 25,
        rotationDeg: 0,
        side: "front",
        partId: "r1",
      },
    ]);
    const map = netsByPad(buildNets(dividerCircuit()), pcb);
    expect(map.get("f_r1:1")).toBe("5V");
    expect(map.get("f_r1:2")).toBe("N$1");
  });
});
