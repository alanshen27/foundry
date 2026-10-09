/**
 * Seat a PCB in an assembly from the two frames the model keeps mixing up.
 *
 * The board part's origin is the centre of the bottom face (Z up through the
 * FR4). A build123d Box is centred, so the housing origin is the middle of the
 * solid and its top face is half the height above that origin. Putting both
 * instances at the same Z parks the board in the walls and leaves the display
 * about half the enclosure height — often ~50 mm, two inches — below the opening.
 */

import type { CadAssemblyInstance } from "@foundry/cad";
import { pcbMechanicalProfile } from "@/lib/pcb/mechanical";
import type { PcbDoc } from "@/lib/pcb/doc";

export type PartBox = {
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
};

export type SeatNote = { componentId: string; text: string };

const LID = /(lid|cover)/i;
const NOT_HOUSING = /(button|knob|lens|light|pipe|cap|foot|gasket|standoff)/i;
const SHELL = /(enclosure|case|housing|shell|chassis|base)/i;

/** A lid or shell. Housings define the frame; the parts inside them must be held. */
export function isHousingPart(part: { name: string; path: string }): boolean {
  const text = `${part.name} ${part.path}`;
  return (LID.test(text) || SHELL.test(text)) && !NOT_HOUSING.test(text);
}
const DISPLAY = /oled|display|lcd|tft|screen|(^|[^a-z])ds\d/i;

function upright(rotation: { x: number; y: number; z: number }): boolean {
  return Math.abs(rotation.x) < 0.05 && Math.abs(rotation.y) < 0.05;
}

function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Lid first — the opening is in it — then the shell. */
export function pickHousingComponent<T extends { id: string; name: string; path: string }>(
  parts: T[],
): T | null {
  const text = (part: T) => `${part.name} ${part.path}`;
  const lid = parts.find((part) => LID.test(text(part)) && !NOT_HOUSING.test(text(part)));
  if (lid) return lid;
  return parts.find((part) => SHELL.test(text(part)) && !NOT_HOUSING.test(text(part))) ?? null;
}

/** Front package the opening is for: a display if one is named, otherwise the tallest body. */
export function displayLocalSeat(board: PcbDoc): {
  x: number;
  y: number;
  topZ: number;
  width: number;
  depth: number;
  refDes: string;
} | null {
  const profile = pcbMechanicalProfile(board);
  const bodies = profile.components.filter(
    (part) =>
      part.side === "front" &&
      typeof part.bodyHeightMm === "number" &&
      typeof part.zMm === "number",
  );
  if (!bodies.length) return null;
  const displays = bodies.filter(
    (part) => DISPLAY.test(part.refDes) || DISPLAY.test(part.libraryId),
  );
  const pool = displays.length ? displays : bodies;
  const chosen = pool.reduce((best, part) =>
    part.zMm! + part.bodyHeightMm! > best.zMm! + best.bodyHeightMm! ? part : best,
  );
  return {
    x: chosen.xMm,
    y: chosen.yMm,
    topZ: chosen.zMm! + chosen.bodyHeightMm!,
    width: profile.widthMm,
    depth: profile.heightMm,
    refDes: chosen.refDes,
  };
}

/**
 * Raise the board so `display.topZ` meets the housing's top face, and slide it
 * back inside when its outline crosses the housing's outer box.
 * XY is left alone when the board is already inside, so a screen that is
 * already under the opening stays there.
 */
export function seatPcbPose(
  pcb: CadAssemblyInstance,
  housing: CadAssemblyInstance,
  housingBox: PartBox,
  display: { x: number; y: number; topZ: number; width: number; depth: number },
): { instance: CadAssemblyInstance; moved: boolean; text: string } {
  if (pcb.fixed || !upright(pcb.rotationDeg) || !upright(housing.rotationDeg)) {
    return {
      instance: pcb,
      moved: false,
      text: "Left the board pose unchanged because it is locked or tilted.",
    };
  }
  const quarterTurn = Math.abs(Math.round(pcb.rotationDeg.z / 90)) % 2 === 1;
  const sizeX = quarterTurn ? display.depth : display.width;
  const sizeY = quarterTurn ? display.width : display.depth;
  const housingTop = housing.translationMm.z + housingBox.center.z + housingBox.size.z / 2;
  const nextZ = roundMm(housingTop - display.topZ);
  let nextX = pcb.translationMm.x;
  let nextY = pcb.translationMm.y;
  let recentered = false;
  const housingMinX = housing.translationMm.x + housingBox.center.x - housingBox.size.x / 2;
  const housingMaxX = housingMinX + housingBox.size.x;
  const housingMinY = housing.translationMm.y + housingBox.center.y - housingBox.size.y / 2;
  const housingMaxY = housingMinY + housingBox.size.y;
  const sticksOut =
    nextX - sizeX / 2 < housingMinX - 0.2 ||
    nextX + sizeX / 2 > housingMaxX + 0.2 ||
    nextY - sizeY / 2 < housingMinY - 0.2 ||
    nextY + sizeY / 2 > housingMaxY + 0.2;
  if (sticksOut) {
    nextX = roundMm(housing.translationMm.x + housingBox.center.x);
    nextY = roundMm(housing.translationMm.y + housingBox.center.y);
    recentered = nextX !== pcb.translationMm.x || nextY !== pcb.translationMm.y;
  }
  const moved =
    nextZ !== pcb.translationMm.z || nextX !== pcb.translationMm.x || nextY !== pcb.translationMm.y;
  const instance = moved
    ? {
        ...pcb,
        translationMm: { x: nextX, y: nextY, z: nextZ },
      }
    : pcb;
  const text = moved
    ? `Seated the board at Z ${nextZ} mm so the display top is flush with the housing top.${
        recentered ? " Centered it because the outline crossed the housing." : ""
      } The board origin is its bottom face; a centered housing origin is its middle, so a shared Z puts the screen about half the housing height too low and the board through the walls.`
    : "Board already meets the housing top.";
  return { instance, moved, text };
}
