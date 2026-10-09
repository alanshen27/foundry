import { stableCadHash } from "@foundry/cad";
import { footprintDef, type PcbDoc, type PcbSide } from "./doc";

export type PcbMechanicalHole = {
  id: string;
  footprintId: string;
  pin: string;
  xMm: number;
  yMm: number;
  drillMm: number;
  plated: boolean;
};

export type PcbMechanicalComponent = {
  footprintId: string;
  partId?: string;
  refDes: string;
  libraryId: string;
  xMm: number;
  yMm: number;
  rotationDeg: number;
  side: PcbSide;
  widthMm: number;
  depthMm: number;
  bodyHeightMm?: number;
  /** Bottom of the body envelope, absent when height is unknown. */
  zMm?: number;
  /**
   * Display glass on top of the carrier, in the component's local CAD frame
   * (before its Z rotation). The carrier is the body minus this height.
   */
  glass?: { wMm: number; hMm: number; heightMm: number; xMm: number; yMm: number };
};

export type PcbMechanicalProfile = {
  boardId: string;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  cornerRadiusMm: number;
  holes: PcbMechanicalHole[];
  components: PcbMechanicalComponent[];
  unknownHeightIds: string[];
  warnings: string[];
};

/** PCB screen coordinates → centered CAD coordinates: X right, Y up, Z up, mm. */
export function pcbMechanicalProfile(board: PcbDoc): PcbMechanicalProfile {
  const { widthMm, heightMm, thicknessMm, cornerRadiusMm } = board.board;
  const profile: PcbMechanicalProfile = {
    boardId: board.id ?? "board-1",
    widthMm,
    heightMm,
    thicknessMm,
    cornerRadiusMm,
    holes: [],
    components: [],
    unknownHeightIds: [],
    warnings: [],
  };
  if (cornerRadiusMm > Math.min(widthMm, heightMm) / 2) {
    profile.warnings.push("Board corner radius exceeds half its smaller dimension");
  }
  for (const fp of board.footprints) {
    const def = footprintDef(fp.libraryId, board.library);
    if (!def) {
      profile.warnings.push(`${fp.refDes}: unknown footprint; mechanical envelope unavailable`);
      profile.unknownHeightIds.push(fp.id);
      continue;
    }
    const angle = (fp.rotationDeg * Math.PI) / 180;
    def.pads.forEach((pad, index) => {
      if (pad.drillMm === undefined || !Number.isFinite(pad.drillMm) || pad.drillMm <= 0) {
        if (pad.plated)
          profile.warnings.push(`${fp.refDes} pad ${pad.pin}: drill diameter unknown`);
        return;
      }
      const x = fp.xMm + pad.xMm * Math.cos(angle) - pad.yMm * Math.sin(angle);
      const y = fp.yMm + pad.xMm * Math.sin(angle) + pad.yMm * Math.cos(angle);
      profile.holes.push({
        id: `${fp.id}:${index}`,
        footprintId: fp.id,
        pin: pad.pin,
        xMm: x - widthMm / 2,
        yMm: heightMm / 2 - y,
        drillMm: pad.drillMm,
        plated: pad.plated === true,
      });
    });
    if (fp.libraryId.startsWith("MountingHole")) continue;
    const bodyHeightMm =
      typeof fp.bodyHeightMm === "number" && Number.isFinite(fp.bodyHeightMm) && fp.bodyHeightMm > 0
        ? fp.bodyHeightMm
        : undefined;
    if (bodyHeightMm === undefined) profile.unknownHeightIds.push(fp.id);
    const standoffMm = fp.standoffMm ?? 0;
    profile.components.push({
      footprintId: fp.id,
      ...(fp.partId ? { partId: fp.partId } : {}),
      refDes: fp.refDes,
      libraryId: fp.libraryId,
      xMm: fp.xMm - widthMm / 2,
      yMm: heightMm / 2 - fp.yMm,
      rotationDeg: -fp.rotationDeg,
      side: fp.side,
      widthMm: def.bodyWMm,
      depthMm: def.bodyHMm,
      ...(bodyHeightMm !== undefined
        ? {
            bodyHeightMm,
            zMm: fp.side === "front" ? thicknessMm + standoffMm : -bodyHeightMm - standoffMm,
          }
        : {}),
      ...(bodyHeightMm !== undefined && def.glass && def.glass.heightMm < bodyHeightMm
        ? { glass: { ...def.glass, yMm: -def.glass.yMm } }
        : {}),
    });
  }
  return profile;
}

/** Routing/selection/name changes do not invalidate a board's mechanical link. */
export function pcbMechanicalSourceHash(board: PcbDoc): string {
  const profile = pcbMechanicalProfile(board);
  return stableCadHash({
    boardId: profile.boardId,
    widthMm: profile.widthMm,
    heightMm: profile.heightMm,
    thicknessMm: profile.thicknessMm,
    cornerRadiusMm: profile.cornerRadiusMm,
    holes: [...profile.holes].sort((a, b) => a.id.localeCompare(b.id)),
    components: profile.components
      .map(({ refDes: _refDes, ...component }) => component)
      .sort((a, b) => a.footprintId.localeCompare(b.footprintId)),
    unknownHeightIds: [...profile.unknownHeightIds].sort(),
  });
}
