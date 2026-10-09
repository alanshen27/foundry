import { describe, expect, it } from "vitest";
import type { CadAssemblyInstance } from "@foundry/cad";
import { normalizePcbSet } from "@/lib/pcb/doc";
import { displayLocalSeat, pickHousingComponent, seatPcbPose } from "@/lib/integration/seat-pcb";

function pose(
  id: string,
  translation: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): CadAssemblyInstance {
  return {
    id,
    componentId: id,
    translationMm: translation,
    rotationDeg: rotation,
    visible: true,
    fixed: false,
  };
}

const housingBox = {
  center: { x: 0, y: 0, z: 0 },
  size: { x: 80, y: 60, z: 100 },
};

function board() {
  return normalizePcbSet({
    version: 2,
    boards: [
      {
        id: "main",
        board: { widthMm: 60, heightMm: 40, thicknessMm: 1.6, cornerRadiusMm: 0 },
        footprints: [
          {
            id: "oled",
            libraryId: "R_0603",
            refDes: "DS1",
            xMm: 30,
            yMm: 20,
            side: "front",
            bodyHeightMm: 8,
            standoffMm: 4,
          },
        ],
      },
    ],
  }).boards[0]!;
}

describe("seatPcbPose", () => {
  const display = displayLocalSeat(board())!;

  it("lifts a board off a centered housing origin so the display meets the top face", () => {
    expect(display.topZ).toBeCloseTo(13.6);
    const seated = seatPcbPose(
      pose("pcb", { x: 0, y: 0, z: 0 }),
      pose("case", { x: 0, y: 0, z: 0 }),
      housingBox,
      display,
    );
    // Housing top is +50. Leaving the board at 0 puts the screen 36.4 mm below it.
    expect(seated.moved).toBe(true);
    expect(seated.instance.translationMm.z).toBeCloseTo(36.4);
    expect(seated.instance.translationMm.x).toBe(0);
    expect(seated.instance.translationMm.y).toBe(0);
  });

  it("keeps a board that already meets the top and sits inside the housing", () => {
    const seated = seatPcbPose(
      pose("pcb", { x: 0, y: 0, z: 36.4 }),
      pose("case", { x: 0, y: 0, z: 0 }),
      housingBox,
      display,
    );
    expect(seated.moved).toBe(false);
    expect(seated.instance.translationMm).toEqual({ x: 0, y: 0, z: 36.4 });
  });

  it("centers a board whose outline crosses the housing", () => {
    const seated = seatPcbPose(
      pose("pcb", { x: 30, y: 0, z: 0 }),
      pose("case", { x: 0, y: 0, z: 0 }),
      housingBox,
      display,
    );
    expect(seated.instance.translationMm.x).toBe(0);
    expect(seated.instance.translationMm.z).toBeCloseTo(36.4);
    expect(seated.text).toMatch(/Centered/);
  });

  it("does not move a tilted board", () => {
    const current = pose("pcb", { x: 4, y: 5, z: 6 }, { x: 90, y: 0, z: 0 });
    const seated = seatPcbPose(current, pose("case", { x: 0, y: 0, z: 0 }), housingBox, display);
    expect(seated.moved).toBe(false);
    expect(seated.instance).toBe(current);
  });
});

describe("pickHousingComponent", () => {
  it("prefers the lid over the shell", () => {
    const picked = pickHousingComponent([
      { id: "shell", name: "Enclosure", path: "parts/enclosure/main.py" },
      { id: "lid", name: "Lid", path: "parts/lid/main.py" },
      { id: "cap", name: "Button cap", path: "parts/button_cap/main.py" },
    ]);
    expect(picked?.id).toBe("lid");
  });
});
