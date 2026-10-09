import { describe, expect, it } from "vitest";
import { cadDoc, stableCadHash, updateComponentContent, upsertPartScript } from "@foundry/cad";
import { normalizePcbSet, type PcbSet } from "@/lib/pcb/doc";
import { pcbAssemblyKcl, pcbCadPartName, pcbPartKcl, legacyPcbPartKcl } from "@/lib/pcb/kcl";
import { pcbMechanicalProfile, pcbMechanicalSourceHash } from "@/lib/pcb/mechanical";
import { pcbPartPython } from "@/lib/pcb/python";
import { syncPcbCadParts } from "@/server/assemble-product";

function fixture(): PcbSet {
  return normalizePcbSet({
    version: 2,
    boards: [
      {
        id: "main",
        name: "Main",
        board: { widthMm: 60, heightMm: 40, thicknessMm: 1.6, cornerRadiusMm: 3 },
        footprints: [
          {
            id: "mount",
            libraryId: "MountingHole_3.2mm",
            refDes: "H1",
            xMm: 5,
            yMm: 7,
            rotationDeg: 0,
            side: "front",
          },
          {
            id: "res",
            libraryId: "R_0603",
            refDes: "R1",
            partId: "r1",
            xMm: 20,
            yMm: 10,
            rotationDeg: 30,
            side: "back",
            bodyHeightMm: 2.5,
          },
          {
            id: "unknown",
            libraryId: "R_0603",
            refDes: "R2",
            xMm: 30,
            yMm: 20,
            rotationDeg: 0,
            side: "front",
          },
        ],
      },
      {
        id: "sensor",
        name: "Sensor",
        board: { widthMm: 20, heightMm: 10, thicknessMm: 0.8, cornerRadiusMm: 0 },
      },
    ],
  });
}

describe("PCB mechanical profile", () => {
  it("converts centers, rotations, mounting drills and sides without inventing heights", () => {
    const profile = pcbMechanicalProfile(fixture().boards[0]!);
    expect(profile.holes[0]).toMatchObject({
      footprintId: "mount",
      xMm: -25,
      yMm: 13,
      drillMm: 3.2,
      plated: false,
    });
    expect(profile.components[0]).toMatchObject({
      footprintId: "res",
      xMm: -10,
      yMm: 10,
      rotationDeg: -30,
      side: "back",
      bodyHeightMm: 2.5,
      zMm: -2.5,
    });
    expect(profile.unknownHeightIds).toEqual(["unknown"]);
    expect(profile.components[1]).not.toHaveProperty("bodyHeightMm");
    expect(profile.components[1]).not.toHaveProperty("zMm");
  });

  it("raises package bodies by their standoff on either side of the board", () => {
    const board = fixture().boards[0]!;
    board.footprints[1]!.standoffMm = 1.5;
    board.footprints[2]!.bodyHeightMm = 3;
    board.footprints[2]!.standoffMm = 8.4;
    const profile = pcbMechanicalProfile(board);
    expect(profile.components[0]).toMatchObject({ bodyHeightMm: 2.5, zMm: -4 });
    expect(profile.components[1]).toMatchObject({ bodyHeightMm: 3, zMm: 10 });
    expect(pcbPartPython(board)).toContain("Pos(0, 0, 10) * Rot(0, 0, 0) * Box(");
    expect(pcbMechanicalSourceHash(board)).not.toBe(pcbMechanicalSourceHash(fixture().boards[0]!));
  });

  it("drops invalid standoffs", () => {
    const [board] = normalizePcbSet({
      version: 2,
      boards: [
        {
          id: "b",
          board: { widthMm: 20, heightMm: 20, thicknessMm: 1.6, cornerRadiusMm: 0 },
          footprints: [
            { id: "a", libraryId: "R_0603", xMm: 5, yMm: 5, standoffMm: -2 },
            { id: "b", libraryId: "R_0603", xMm: 9, yMm: 5, standoffMm: 250 },
            { id: "c", libraryId: "R_0603", xMm: 13, yMm: 5, standoffMm: 4 },
          ],
        },
      ],
    }).boards;
    expect(board!.footprints.map((fp) => fp.standoffMm)).toEqual([undefined, undefined, 4]);
  });

  it("hashes mechanical changes, ignoring tracks and board display names", () => {
    const board = fixture().boards[0]!;
    const renamed = {
      ...board,
      name: "Renamed",
      tracks: [
        {
          id: "trace",
          layer: "F.Cu" as const,
          widthMm: 0.25,
          points: [
            { xMm: 1, yMm: 1 },
            { xMm: 2, yMm: 2 },
          ],
        },
      ],
    };
    expect(pcbMechanicalSourceHash(renamed)).toBe(pcbMechanicalSourceHash(board));
    const changed = structuredClone(board);
    changed.footprints[1]!.bodyHeightMm = 5;
    expect(pcbMechanicalSourceHash(changed)).not.toBe(pcbMechanicalSourceHash(board));
    expect(pcbCadPartName(board, 1)).toBe(pcbCadPartName(renamed, 2));
  });

  it("generates one substrate with real rounded edges and holes", () => {
    const board = fixture().boards[0]!;
    const kcl = pcbPartKcl(board);
    expect(kcl).toContain("cornerRadius = 3");
    expect(kcl.match(/arc\(/g)).toHaveLength(4);
    expect(kcl).toContain("center = [-25, 13], radius = 1.6");
    expect(kcl).toContain("board = subtract(boardBlank, tools = [hole1])");
    expect(kcl.trim().endsWith("board")).toBe(true);
    const preview = pcbAssemblyKcl(board);
    expect(preview).toContain("angle = -30deg");
    expect(preview).toContain("z = -2.5");
    expect(preview).toContain("1 package heights are unknown");
    expect(preview).not.toContain("approximate footprint");
  });
});

describe("safe all-board CAD sync", () => {
  it("keeps each board's stable source identity and placement when renamed or another board is removed", () => {
    const set = fixture();
    const initial = cadDoc("// user's housing");
    const result = syncPcbCadParts(initial, set);
    expect(result.updated).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
    expect(initial.components).toHaveLength(3);
    const board = result.doc.components.find((c) => c.source?.boardId === "main")!;
    const renamed = { ...set, boards: [{ ...set.boards[0]!, name: "Renamed" }] };
    const next = syncPcbCadParts(result.doc, renamed);
    expect(next.removed).toHaveLength(1);
    expect(next.doc.components.find((c) => c.source?.boardId === "main")).toMatchObject({
      id: board.id,
      path: board.path,
    });
    expect(next.doc.components[0]).toEqual(initial.components[0]);
    expect(syncPcbCadParts(next.doc, renamed).updated).toEqual([]);
  });

  it("preserves custom generated files on update and removal and reports conflicts", () => {
    const set = fixture();
    const synced = syncPcbCadParts(cadDoc("housing = 1"), set).doc;
    const board = synced.components.find((c) => c.source?.boardId === "main")!;
    const custom = updateComponentContent(
      synced,
      board.id,
      board.content + "\n// Custom clearance cutout",
    );
    const changed = structuredClone(set);
    changed.boards[0]!.board.widthMm = 70;
    for (const target of [changed, { version: 2 as const, boards: [] }]) {
      const result = syncPcbCadParts(custom, target);
      expect(result.conflicts.some((c) => c.includes(board.path))).toBe(true);
      expect(result.doc.components.find((c) => c.id === board.id)!.content).toBe(
        custom.components.find((c) => c.id === board.id)!.content,
      );
    }
  });

  it("adopts exactly recognizable legacy generator output but never overwrites an unknown legacy part", () => {
    const set = fixture();
    const legacy = upsertPartScript(cadDoc("housing = 1"), "pcb", legacyPcbPartKcl(set.boards[0]!));
    const adopted = syncPcbCadParts(legacy, set);
    expect(adopted.conflicts).toEqual([]);
    expect(
      adopted.doc.components.find((c) => c.path === "parts/pcb/main.kcl")!.source,
    ).toMatchObject({ kind: "pcb", boardId: "main" });
    const unknown = upsertPartScript(legacy, "pcb", "// hand-authored circuit carrier");
    const result = syncPcbCadParts(unknown, set);
    expect(result.conflicts).toHaveLength(1);
    expect(result.updated).toEqual([]);
    expect(result.doc.components).toEqual(unknown.components);
  });

  it("updates source fingerprints when only component clearance metadata changes", () => {
    const set = fixture();
    const synced = syncPcbCadParts(cadDoc("housing = 1"), set).doc;
    const board = synced.components.find((c) => c.source?.boardId === "main")!;
    const changed = structuredClone(set);
    changed.boards[0]!.footprints[1]!.bodyHeightMm = 4;
    const result = syncPcbCadParts(synced, changed);
    const next = result.doc.components.find((c) => c.id === board.id)!;
    expect(next.content).toBe(board.content);
    expect(next.source!.sourceHash).not.toBe(board.source!.sourceHash);
    expect(next.source!.generatedHash).toBe(stableCadHash(next.content));
  });
});
