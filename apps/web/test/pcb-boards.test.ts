import { describe, expect, it } from "vitest";
import type { CircuitDoc, CircuitGroup } from "@/lib/circuit/catalog";
import { normalizeCircuitDoc } from "@/lib/circuit/catalog";
import { circuitForGroup, groupOfPart, partitionBoards } from "@/lib/circuit/groups";
import { createBoard, emptyPcbSet, normalizePcbSet } from "@/lib/pcb/doc";
import { buildRatsnest } from "@/lib/pcb/netlist";

const MAIN: CircuitGroup = { id: "g1", label: "Main", x: 0, y: 0, w: 300, h: 300 };
const SENSOR: CircuitGroup = { id: "g2", label: "Sensor", x: 500, y: 0, w: 300, h: 300 };

/**
 * MCU and R1 on the main board, the sensor and R2 on a separate one. The MCU
 * to sensor signal crosses between boards; each board also has a local net.
 */
function splitCircuit(groups: CircuitGroup[] = [MAIN, SENSOR]): CircuitDoc {
  return {
    version: 2,
    groups,
    parts: [
      { id: "mcu", type: "wokwi-arduino-uno", label: "U1", x: 50, y: 50 },
      { id: "r1", type: "wokwi-resistor", label: "R1", x: 150, y: 50 },
      { id: "sense", type: "wokwi-dht22", label: "S1", x: 550, y: 50 },
      { id: "r2", type: "wokwi-resistor", label: "R2", x: 650, y: 50 },
    ],
    wires: [
      // Local to Main.
      { id: "w1", from: { part: "mcu", pin: "5V" }, to: { part: "r1", pin: "1" } },
      // Local to Sensor.
      { id: "w2", from: { part: "sense", pin: "SDA" }, to: { part: "r2", pin: "1" } },
      // Crosses between the two boards.
      { id: "w3", from: { part: "mcu", pin: "A0" }, to: { part: "sense", pin: "VCC" } },
    ],
  };
}

describe("normalizeCircuitDoc — groups", () => {
  it("defaults groups on a document without them", () => {
    expect(normalizeCircuitDoc({ version: 2, parts: [], wires: [] }).groups).toEqual([]);
  });

  it("drops a region with no area", () => {
    const doc = normalizeCircuitDoc({
      version: 2,
      parts: [],
      wires: [],
      groups: [
        { id: "ok", label: "A", x: 0, y: 0, w: 10, h: 10 },
        { id: "flat", label: "B", x: 0, y: 0, w: 0, h: 10 },
        { id: "neg", label: "C", x: 0, y: 0, w: -5, h: 10 },
      ],
    });
    expect(doc.groups.map((g) => g.id)).toEqual(["ok"]);
  });

  it("names an unlabelled region", () => {
    const doc = normalizeCircuitDoc({
      version: 2,
      parts: [],
      wires: [],
      groups: [{ x: 0, y: 0, w: 10, h: 10 }],
    });
    expect(doc.groups[0]!.label).toBe("Board 1");
  });
});

describe("groupOfPart", () => {
  it("places a part inside its region", () => {
    expect(groupOfPart([MAIN, SENSOR], { x: 50, y: 50 })?.id).toBe("g1");
    expect(groupOfPart([MAIN, SENSOR], { x: 550, y: 50 })?.id).toBe("g2");
  });

  it("returns null for a part in the gap between regions", () => {
    expect(groupOfPart([MAIN, SENSOR], { x: 400, y: 50 })).toBeNull();
  });

  it("includes the boundary", () => {
    expect(groupOfPart([MAIN], { x: 300, y: 300 })?.id).toBe("g1");
    expect(groupOfPart([MAIN], { x: 301, y: 300 })).toBeNull();
  });

  it("gives the first region in document order when they overlap", () => {
    const a: CircuitGroup = { id: "a", label: "A", x: 0, y: 0, w: 100, h: 100 };
    const b: CircuitGroup = { id: "b", label: "B", x: 50, y: 50, w: 100, h: 100 };
    expect(groupOfPart([a, b], { x: 60, y: 60 })?.id).toBe("a");
    expect(groupOfPart([b, a], { x: 60, y: 60 })?.id).toBe("b");
  });
});

describe("partitionBoards", () => {
  it("assigns each part to its board", () => {
    const p = partitionBoards(splitCircuit());
    expect(p.slices.map((s) => s.group.id)).toEqual(["g1", "g2"]);
    expect(p.slices[0]!.partIds).toEqual(["mcu", "r1"]);
    expect(p.slices[1]!.partIds).toEqual(["sense", "r2"]);
    expect(p.ungroupedPartIds).toEqual([]);
  });

  it("finds the net that has to leave the board", () => {
    const p = partitionBoards(splitCircuit());
    expect(p.crossings).toHaveLength(1);
    expect(p.crossings[0]!.groupLabels).toEqual(["Main", "Sensor"]);
    // Both boards must carry a connector for it.
    expect(p.slices[0]!.crossingNets).toEqual(p.crossings.map((c) => c.net));
    expect(p.slices[1]!.crossingNets).toEqual(p.crossings.map((c) => c.net));
  });

  it("keeps local nets internal", () => {
    const p = partitionBoards(splitCircuit());
    expect(p.slices[0]!.internalNets).toHaveLength(1);
    expect(p.slices[1]!.internalNets).toHaveLength(1);
  });

  it("reports a part left outside every region", () => {
    const c = splitCircuit();
    c.parts.push({ id: "stray", type: "wokwi-resistor", label: "R9", x: 400, y: 400 });
    const p = partitionBoards(c);
    expect(p.ungroupedPartIds).toEqual(["stray"]);
  });

  it("flags overlapping regions as ambiguous", () => {
    const p = partitionBoards(
      splitCircuit([MAIN, { id: "g3", label: "Overlap", x: 200, y: 200, w: 400, h: 400 }]),
    );
    expect(p.overlaps).toHaveLength(1);
    expect(p.overlaps[0]!.aLabel).toBe("Main");
  });

  it("treats an ungrouped schematic as one board with no crossings", () => {
    const p = partitionBoards(splitCircuit([]));
    expect(p.slices).toEqual([]);
    expect(p.crossings).toEqual([]);
    expect(p.ungroupedPartIds).toHaveLength(4);
  });

  it("notes when a crossing net also reaches an ungrouped part", () => {
    const c = splitCircuit();
    c.parts.push({ id: "stray", type: "wokwi-resistor", label: "R9", x: 400, y: 400 });
    c.wires.push({ id: "w4", from: { part: "stray", pin: "1" }, to: { part: "mcu", pin: "A0" } });
    const p = partitionBoards(c);
    expect(p.crossings[0]!.touchesUngrouped).toBe(true);
  });
});

describe("circuitForGroup", () => {
  it("keeps only that board's parts", () => {
    const sliced = circuitForGroup(splitCircuit(), "g1");
    expect(sliced.parts.map((p) => p.id)).toEqual(["mcu", "r1"]);
  });

  it("drops the wire that crosses to the other board", () => {
    const sliced = circuitForGroup(splitCircuit(), "g1");
    // w1 is local; w3 leaves the board and becomes a connector instead.
    expect(sliced.wires.map((w) => w.id)).toEqual(["w1"]);
  });

  it("returns the whole schematic when no group is given", () => {
    expect(circuitForGroup(splitCircuit(), null).parts).toHaveLength(4);
  });

  it("stops the ratsnest demanding a trace to an off-board part", () => {
    const board = {
      board: { widthMm: 80, heightMm: 50 },
      footprints: [
        { id: "f1", libraryId: "SOIC-8", refDes: "U1", xMm: 20, yMm: 20, rotationDeg: 0, side: "front", partId: "mcu" },
      ],
    };
    const { boards } = normalizePcbSet({ boards: [board] });
    const whole = buildRatsnest(splitCircuit(), boards[0]!);
    const sliced = buildRatsnest(circuitForGroup(splitCircuit(), "g1"), boards[0]!);
    // The off-board sensor is no longer reported as an unplaced part.
    expect(whole.issues.unlinkedParts.map((u) => u.partId)).toContain("sense");
    expect(sliced.issues.unlinkedParts.map((u) => u.partId)).not.toContain("sense");
  });
});

describe("normalizePcbSet", () => {
  it("lifts a legacy single board into a set", () => {
    const set = normalizePcbSet({
      board: { widthMm: 60, heightMm: 40 },
      footprints: [
        { id: "f1", libraryId: "R_0603", refDes: "R1", xMm: 10, yMm: 10, rotationDeg: 0, side: "front" },
      ],
    });
    expect(set.boards).toHaveLength(1);
    expect(set.boards[0]!.id).toBe("board-1");
    expect(set.boards[0]!.board.widthMm).toBe(60);
    expect(set.boards[0]!.footprints).toHaveLength(1);
    expect(set.activeBoardId).toBe("board-1");
  });

  it("reads a multi-board set back", () => {
    const set = normalizePcbSet({
      version: 2,
      boards: [
        { id: "a", name: "Main", groupId: "g1", board: { widthMm: 50, heightMm: 50 } },
        { id: "b", name: "Sensor", groupId: "g2", board: { widthMm: 30, heightMm: 20 } },
      ],
      activeBoardId: "b",
    });
    expect(set.boards.map((b) => b.name)).toEqual(["Main", "Sensor"]);
    expect(set.boards[1]!.groupId).toBe("g2");
    expect(set.activeBoardId).toBe("b");
  });

  it("always yields at least one board", () => {
    expect(normalizePcbSet({ version: 2, boards: [] }).boards).toHaveLength(1);
    expect(normalizePcbSet(null).boards).toHaveLength(1);
  });

  it("de-duplicates ids so the switcher cannot address two boards", () => {
    const set = normalizePcbSet({
      version: 2,
      boards: [
        { id: "same", board: { widthMm: 50, heightMm: 50 } },
        { id: "same", board: { widthMm: 30, heightMm: 30 } },
      ],
    });
    expect(new Set(set.boards.map((b) => b.id)).size).toBe(2);
  });

  it("falls back to the first board when the active id is unknown", () => {
    const set = normalizePcbSet({
      version: 2,
      boards: [{ id: "a", board: { widthMm: 50, heightMm: 50 } }],
      activeBoardId: "gone",
    });
    expect(set.activeBoardId).toBe("a");
  });

  it("round-trips a set it produced", () => {
    const once = normalizePcbSet(emptyPcbSet());
    expect(normalizePcbSet(once)).toEqual(once);
  });
});

describe("createBoard", () => {
  it("takes the group's label and a free id", () => {
    const set = emptyPcbSet();
    const made = createBoard(set.boards, "g2", "Sensor");
    expect(made.id).toBe("board-2");
    expect(made.name).toBe("Sensor");
    expect(made.groupId).toBe("g2");
  });

  it("does not reuse an id already taken", () => {
    const made = createBoard([
      { ...emptyPcbSet().boards[0]!, id: "board-2" },
    ]);
    expect(made.id).not.toBe("board-2");
  });
});
