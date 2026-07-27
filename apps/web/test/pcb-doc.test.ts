import { describe, expect, it } from "vitest";
import {
  EMPTY_PCB,
  createFootprint,
  normalizePcbDoc,
  searchFootprints,
  unsupportedFootprintIds,
} from "@/lib/pcb/doc";

describe("normalizePcbDoc", () => {
  it("returns a default board for empty input", () => {
    const doc = normalizePcbDoc(null);
    expect(doc.version).toBe(1);
    expect(doc.board.widthMm).toBe(EMPTY_PCB.board.widthMm);
    expect(doc.footprints).toEqual([]);
  });

  it("clamps board dimensions and drops unknown footprints", () => {
    const doc = normalizePcbDoc({
      board: { widthMm: 2000, heightMm: 1, thicknessMm: 99, cornerRadiusMm: -3 },
      footprints: [
        { id: "a", libraryId: "R_0603", refDes: "R1", xMm: 10, yMm: 10, rotationDeg: 90, side: "front" },
        { id: "b", libraryId: "not-a-real-fp", refDes: "X1", xMm: 0, yMm: 0, rotationDeg: 0, side: "front" },
      ],
    });
    expect(doc.board.widthMm).toBe(500);
    expect(doc.board.heightMm).toBe(5);
    expect(doc.board.thicknessMm).toBe(6.4);
    expect(doc.board.cornerRadiusMm).toBe(0);
    expect(doc.footprints).toHaveLength(1);
    expect(doc.footprints[0]?.libraryId).toBe("R_0603");
    expect(doc.footprints[0]?.rotationDeg).toBe(90);
  });
});

describe("createFootprint", () => {
  it("assigns incremental ref des", () => {
    const a = createFootprint("R_0603", [], { xMm: 5, yMm: 5 });
    const b = createFootprint("R_0603", a ? [a] : [], { xMm: 8, yMm: 8 });
    expect(a?.refDes).toBe("R1");
    expect(b?.refDes).toBe("R2");
  });

  it("returns null for unknown library ids", () => {
    expect(createFootprint("nope", [])).toBeNull();
  });
});

describe("searchFootprints", () => {
  it("filters by keyword", () => {
    const hits = searchFootprints("soic");
    expect(hits.some((f) => f.id === "SOIC-8")).toBe(true);
    expect(hits.every((f) => f.keywords.includes("soic") || f.name.toLowerCase().includes("soic"))).toBe(
      true,
    );
  });
});

describe("unsupportedFootprintIds", () => {
  it("lists unknown library ids", () => {
    expect(
      unsupportedFootprintIds([
        { libraryId: "R_0603" },
        { libraryId: "Fake_FP" },
        { libraryId: "Fake_FP" },
      ]),
    ).toEqual(["Fake_FP"]);
  });
});
