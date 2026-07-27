/**
 * PCB doc → approximate KCL (mm) for the final-assembly viewport. Board slab
 * plus a box body per footprint — SIMULATED placement, not fab geometry.
 */
import { footprintDef, type PcbDoc } from "./doc";

const FOOTPRINT_BODY_H = 0.8;
/** Keep the generated script bounded on very dense boards. */
const MAX_FOOTPRINT_BODIES = 160;

function n(v: number): string {
  return String(Number(v.toFixed(3)));
}

function boxKcl(
  name: string,
  xMm: number,
  yMm: number,
  wMm: number,
  hMm: number,
  lengthMm: number,
  zMm: number,
): string {
  const lines = [
    `${name}Sketch = startSketchOn(XY)`,
    `${name}Profile = startProfile(${name}Sketch, at = [${n(xMm - wMm / 2)}, ${n(yMm - hMm / 2)}])`,
    `  |> line(end = [${n(wMm)}, 0])`,
    `  |> line(end = [0, ${n(hMm)}])`,
    `  |> line(end = [${n(-wMm)}, 0])`,
    `  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])`,
    `  |> close()`,
    `${name} = extrude(${name}Profile, length = ${n(lengthMm)})`,
  ];
  if (zMm !== 0) {
    lines[lines.length - 1] += `\n  |> translate(z = ${n(zMm)})`;
  }
  return lines.join("\n");
}

/**
 * Inline KCL that draws the board and footprint bodies centred on the origin.
 * `zOffsetMm` lifts the whole board (e.g. standoff height inside an enclosure).
 */
export function pcbAssemblyKcl(
  doc: PcbDoc,
  opts?: { zOffsetMm?: number; prefix?: string },
): string {
  const p = opts?.prefix ?? "fpcb";
  const z = opts?.zOffsetMm ?? 0;
  const { widthMm: w, heightMm: h, thicknessMm: t } = doc.board;

  const blocks: string[] = [
    `// SIMULATED PCB — ${n(w)} x ${n(h)} mm board with approximate footprint bodies.`,
    boxKcl(`${p}Board`, 0, 0, w, h, t, z),
  ];

  let i = 0;
  for (const fp of doc.footprints) {
    if (i >= MAX_FOOTPRINT_BODIES) break;
    const def = footprintDef(fp.libraryId);
    if (!def) continue;
    if (fp.libraryId.startsWith("MountingHole")) continue;

    const rotated = Math.abs(fp.rotationDeg % 180) === 90;
    const bw = rotated ? def.bodyHMm : def.bodyWMm;
    const bh = rotated ? def.bodyWMm : def.bodyHMm;
    // PCB doc (0,0) is top-left with +y downwards; KCL XY is centred, +y up.
    const cx = fp.xMm - w / 2;
    const cy = h / 2 - fp.yMm;
    const bodyZ = fp.side === "front" ? z + t : z - FOOTPRINT_BODY_H;
    blocks.push(boxKcl(`${p}Fp${i}`, cx, cy, bw, bh, FOOTPRINT_BODY_H, bodyZ));
    i += 1;
  }

  return blocks.join("\n\n") + "\n";
}
