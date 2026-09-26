import { describe, expect, it } from "vitest";
import type { CircuitDoc } from "@/lib/circuit/catalog";
import { normalizePcbDoc } from "@/lib/pcb/doc";
import { syncPcbFromSchematic, wiredPinsForPart } from "@/lib/pcb/schematic-sync";
import { buildRatsnest, netsByPad } from "@/lib/pcb/netlist";
import { runDrc } from "@/lib/pcb/drc";
import { circuitForGroup } from "@/lib/circuit/groups";

const circuit: CircuitDoc = {
  version: 2,
  groups: [],
  parts: [
    { id: "r", type: "wokwi-resistor", label: "R1", attrs: { value: "10k" }, x: 20, y: 20 },
    { id: "led", type: "wokwi-led", label: "D1", x: 200, y: 20 },
    { id: "mcu", type: "wokwi-esp32-devkit-v1", label: "U1", x: 200, y: 200 },
  ],
  wires: [
    { id: "w1", from: { part: "r", pin: "1" }, to: { part: "led", pin: "A" } },
    { id: "w2", from: { part: "r", pin: "2" }, to: { part: "led", pin: "C" } },
  ],
};

function board() {
  return normalizePcbDoc({
    id: "board-1",
    name: "Main",
    board: { widthMm: 60, heightMm: 40 },
    footprints: [
      {
        id: "existing",
        libraryId: "R_0603",
        partId: "r",
        refDes: "R1",
        value: "1k",
        xMm: 18,
        yMm: 12,
        rotationDeg: 90,
        side: "back",
        bodyHeightMm: 1.1,
      },
    ],
    tracks: [
      {
        id: "trace",
        net: "N$1",
        layer: "F.Cu",
        widthMm: 0.25,
        points: [
          { xMm: 18, yMm: 12 },
          { xMm: 30, yMm: 12 },
        ],
      },
    ],
    vias: [{ id: "via", xMm: 30, yMm: 12, drillMm: 0.3, diameterMm: 0.6, net: "N$1" }],
    zones: [
      {
        id: "zone",
        net: "N$1",
        layer: "B.Cu",
        points: [
          { xMm: 2, yMm: 2 },
          { xMm: 40, yMm: 2 },
          { xMm: 40, yMm: 30 },
        ],
      },
    ],
  });
}

describe("schematic to PCB reconciliation", () => {
  it("adds only explicitly selected packages and never infers an MCU footprint", () => {
    const result = syncPcbFromSchematic(circuit, normalizePcbDoc(null), [
      { partId: "r", libraryId: "R_0603" },
    ]);
    expect(result.doc.footprints.map((fp) => fp.partId)).toEqual(["r"]);
    expect(
      result.issues
        .filter((issue) => issue.code === "missing-package")
        .map((issue) => issue.partId),
    ).toEqual(["led", "mcu"]);
  });

  it("preserves existing identities, placement, side, height and all routing", () => {
    const before = board();
    const snapshot = structuredClone(before);
    const assignments = [
      { partId: "r", libraryId: "R_0603" },
      { partId: "led", libraryId: "LED_0805", pinMap: { A: "1", C: "2" } },
    ];
    const result = syncPcbFromSchematic(circuit, before, assignments);
    expect(result.doc.footprints[0]).toEqual({ ...before.footprints[0], value: "10k" });
    expect(result.doc.tracks).toBe(before.tracks);
    expect(result.doc.vias).toBe(before.vias);
    expect(result.doc.zones).toBe(before.zones);
    expect(result.doc.board).toBe(before.board);
    expect(result.added).toHaveLength(1);
    expect(result.updated).toEqual(["existing"]);
    expect(result.issues.some((issue) => issue.code === "unmapped-pin")).toBe(false);
    expect(before).toEqual(snapshot);

    const repeated = syncPcbFromSchematic(circuit, result.doc, assignments);
    expect(repeated.doc).toEqual(result.doc);
    expect(repeated.added).toEqual([]);
    expect(repeated.updated).toEqual([]);
  });

  it("does not choose between duplicate links or duplicate assignments", () => {
    const before = board();
    before.footprints.push({ ...before.footprints[0]!, id: "duplicate", refDes: "R2" });
    const result = syncPcbFromSchematic(circuit, before, [
      { partId: "r", libraryId: "R_0805" },
      { partId: "led", libraryId: "LED_0805" },
      { partId: "led", libraryId: "R_0603" },
    ]);
    expect(result.doc).toEqual(before);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["duplicate-link", "duplicate-assignment"]),
    );
  });

  it("keeps removed parts and their routing as explicit dangling links", () => {
    const before = board();
    const result = syncPcbFromSchematic(
      { ...circuit, parts: circuit.parts.filter((part) => part.id !== "r"), wires: [] },
      before,
      [],
    );
    expect(result.doc).toEqual(before);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "dangling-link", partId: "r" }),
    );
  });

  it("rejects unknown packages, out-of-region part IDs, and nonexistent pads", () => {
    const before = board();
    const result = syncPcbFromSchematic(circuit, before, [
      { partId: "r", libraryId: "R_0603", pinMap: { "1": "404" } },
      { partId: "led", libraryId: "ImaginedPackage" },
      { partId: "missing", libraryId: "R_0603" },
    ]);
    expect(result.doc).toEqual(before);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["unknown-package", "unknown-part", "unmapped-pin"]),
    );
  });

  it("reports ambiguous pin assignments and preserves an explicitly changed package's placement", () => {
    const before = board();
    const result = syncPcbFromSchematic(circuit, before, [
      { partId: "r", libraryId: "R_0805" },
      { partId: "led", libraryId: "LED_0805", pinMap: { A: "1", C: "1" } },
    ]);
    expect(result.doc.footprints[0]).toMatchObject({
      id: "existing",
      xMm: 18,
      yMm: 12,
      rotationDeg: 90,
      side: "back",
      libraryId: "R_0805",
    });
    expect(result.doc.footprints[0]?.bodyHeightMm).toBeUndefined();
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["package-changed", "pin-map-conflict"]),
    );
  });

  it("only reconciles the selected board's schematic region", () => {
    const split = {
      ...circuit,
      groups: [{ id: "small", label: "Resistor board", x: 0, y: 0, w: 100, h: 100 }],
    };
    const result = syncPcbFromSchematic(circuitForGroup(split, "small"), board(), [
      { partId: "r", libraryId: "R_0603" },
    ]);
    expect(result.doc.footprints).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });
});

describe("electrical link readiness", () => {
  it("reports every wired pin and keeps duplicate footprint resolution consistent", () => {
    expect(wiredPinsForPart(circuit, "led")).toEqual(["A", "C"]);
    const pcb = board();
    pcb.footprints.push({ ...pcb.footprints[0]!, id: "duplicate", refDes: "R2" });
    const ratsnest = buildRatsnest(circuit, pcb);
    const padNets = netsByPad(ratsnest.nets, pcb);
    expect(padNets.has("existing:1")).toBe(true);
    expect(padNets.has("duplicate:1")).toBe(false);
    expect(ratsnest.issues.danglingFootprints).toContainEqual({ refDes: "R2", partId: "r" });
  });

  it("cannot report a clean board while schematic parts or pad links are missing", () => {
    const pcb = normalizePcbDoc(null);
    const missing = runDrc(pcb, buildRatsnest(circuit, pcb));
    expect(missing.violations.filter((issue) => issue.rule === "unlinked-parts")).toHaveLength(2);
    const generated = syncPcbFromSchematic(circuit, pcb, [
      { partId: "led", libraryId: "LED_0805" },
    ]).doc;
    expect(
      runDrc(generated, buildRatsnest(circuit, generated)).violations.some(
        (issue) => issue.rule === "unmapped-pins",
      ),
    ).toBe(true);
  });

  it("reports a pad mapped to distinct schematic nets", () => {
    const pcb = syncPcbFromSchematic(circuit, board(), [
      { partId: "led", libraryId: "LED_0805", pinMap: { A: "1", C: "1" } },
    ]).doc;
    expect(
      runDrc(pcb, buildRatsnest(circuit, pcb)).violations.some(
        (issue) => issue.rule === "pin-map-conflict",
      ),
    ).toBe(true);
  });
});
