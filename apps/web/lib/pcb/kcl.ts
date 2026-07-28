/**
 * PCB doc → parametric KCL part (`parts/pcb/main.kcl`) for the product assembly.
 *
 * Zoo whole-module imports must return a **single** solid. Footprint bodies are
 * therefore omitted here (they live in the 2D PCB editor); the board slab with
 * `width` / `depth` / `thickness` params is what Assembly mates against.
 */
import { footprintDef, type PcbDoc } from "./doc";

export const PCB_PART_PATH = "parts/pcb/main.kcl";
export const PCB_PART_NAME = "pcb";

const FOOTPRINT_BODY_H = 0.8;
const MAX_FOOTPRINT_BODIES = 160;

function n(v: number): string {
  return String(Number(v.toFixed(3)));
}

/**
 * Parametric board slab centred on the origin — one solid for module import.
 * `width` / `depth` / `thickness` are visual parameters (see parseCadParams).
 */
export function pcbPartKcl(doc: PcbDoc): string {
  const { widthMm: w, heightMm: h, thicknessMm: t } = doc.board;
  const fpCount = doc.footprints.length;

  return [
    "// SIMULATED PCB board for assembly — single solid (Zoo module import rule).",
    `// Footprints (${fpCount}) stay in Engineer > PCB; dims are CAD params.`,
    `width = ${n(w)}`,
    `depth = ${n(h)}`,
    `thickness = ${n(t)}`,
    "",
    "boardSketch = startSketchOn(XY)",
    "boardProfile = startProfile(boardSketch, at = [-width / 2, -depth / 2])",
    "  |> line(end = [width, 0])",
    "  |> line(end = [0, depth])",
    "  |> line(end = [-width, 0])",
    "  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])",
    "  |> close()",
    "board = extrude(boardProfile, length = thickness)",
    "board",
    "",
  ].join("\n");
}

/** Inline multi-body PCB for synthesized scenes (not imported as a module). */
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
    const cx = fp.xMm - w / 2;
    const cy = h / 2 - fp.yMm;
    const bodyZ = fp.side === "front" ? z + t : z - FOOTPRINT_BODY_H;
    blocks.push(boxKcl(`${p}Fp${i}`, cx, cy, bw, bh, FOOTPRINT_BODY_H, bodyZ));
    i += 1;
  }
  return blocks.join("\n\n") + "\n";
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
