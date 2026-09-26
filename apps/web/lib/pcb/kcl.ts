/**
 * PCB doc → parametric KCL part(s) for the product assembly.
 *
 * One physical board → one CAD part, identified by its stable board ID.
 * The substrate includes the declared radius and drilled holes. Components
 * use explicit package heights in the separate mechanical profile.
 *
 * Zoo whole-module imports must return a **single** solid. Footprint bodies are
 * therefore omitted from the manufacturing module. The board remains a
 * single solid that assembly imports without redrawing its geometry.
 */
import { stableCadHash } from "@foundry/cad";
import { type PcbDoc, type PcbSet } from "./doc";
import { pcbMechanicalProfile } from "./mechanical";

export const PCB_PART_PATH = "parts/pcb/main.kcl";
export const PCB_PART_NAME = "pcb";

const MAX_FOOTPRINT_BODIES = 160;

function n(v: number): string {
  return String(Number(v.toFixed(9)));
}

/** Sanitize a board name/id into a CAD path segment. */
export function slugifyPcbPartName(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "board";
}

/** Board identity, rather than name or board count, determines its generated path. */
export function pcbCadPartName(board: Pick<PcbDoc, "id" | "name">, _boardCount?: number): string {
  const id = board.id ?? "board-1";
  return `pcb-${slugifyPcbPartName(id).slice(0, 18)}-${stableCadHash(id).slice(5)}`;
}

export function pcbCadPartPath(partName: string): string {
  const slug = slugifyPcbPartName(partName);
  if (slug === "pcb" || slug === "main") return PCB_PART_PATH;
  return `parts/${slug}/main.kcl`;
}

/** True when a CadDoc part path is one we manage for PCB boards. */
export function isManagedPcbCadPartPath(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  if (p === PCB_PART_PATH || p === "parts/pcb.kcl") return true;
  return /^parts\/pcb(?:-[a-z0-9-]+)?(?:\/main)?\.kcl$/i.test(p);
}

/** IDs must already be unique (normalizePcbSet guarantees this). */
export function pcbCadPartNamesForSet(set: PcbSet): Map<string, string> {
  return new Map(set.boards.map((board) => [board.id ?? "board-1", pcbCadPartName(board)]));
}

/**
 * Parametric board slab centred on the origin — one solid for module import.
 * `width` / `depth` / `thickness` are visual parameters (see parseCadParams).
 */
export function legacyPcbPartKcl(doc: PcbDoc): string {
  // Match the previous generator byte-for-byte (apart from outer whitespace).
  const n = (value: number) => String(Number(value.toFixed(3)));
  const { widthMm: w, heightMm: h, thicknessMm: t } = doc.board;
  const fpCount = doc.footprints.length;
  const label = doc.name?.trim() || doc.id || "board";

  return [
    `// SIMULATED PCB board (${label}) for assembly — single solid (Zoo module import rule).`,
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

/** One authoritative substrate solid with the declared outline and explicit drills. */
export function pcbPartKcl(doc: PcbDoc): string {
  const profile = pcbMechanicalProfile(doc);
  const { widthMm: w, heightMm: h, thicknessMm: t, cornerRadiusMm: r } = profile;
  if (
    ![w, h, t].every((v) => Number.isFinite(v) && v > 0) ||
    !Number.isFinite(r) ||
    r < 0 ||
    r > Math.min(w, h) / 2
  ) {
    throw new Error(`Invalid mechanical board dimensions: ${profile.boardId}`);
  }
  const label = (doc.name?.trim() || profile.boardId).replace(/[\r\n]/g, " ");
  const lines = [
    `// LOCAL PCB substrate (${label}) — declared outline and drills, millimetres.`,
    "// UNVERIFIED engineering: component envelopes and connector access require clearance review.",
    `width = ${n(w)}`,
    `depth = ${n(h)}`,
    `thickness = ${n(t)}`,
    `cornerRadius = ${n(r)}`,
    "",
    "boardSketch = startSketchOn(XY)",
  ];
  if (r === 0) {
    lines.push(
      "boardProfile = startProfile(boardSketch, at = [-width / 2, -depth / 2])",
      "  |> line(end = [width, 0])",
      "  |> line(end = [0, depth])",
      "  |> line(end = [-width, 0])",
      "  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])",
      "  |> close()",
    );
  } else {
    lines.push(
      "boardProfile = startProfile(boardSketch, at = [width / 2 - cornerRadius, -depth / 2])",
    );
    // Explicit quarter arcs also support capsule/circle outlines without zero-length lines.
    lines.push("  |> arc(angleStart = -90deg, angleEnd = 0deg, radius = cornerRadius)");
    if (h > 2 * r) lines.push("  |> line(end = [0, depth - 2 * cornerRadius])");
    lines.push("  |> arc(angleStart = 0deg, angleEnd = 90deg, radius = cornerRadius)");
    if (w > 2 * r) lines.push("  |> line(end = [-(width - 2 * cornerRadius), 0])");
    lines.push("  |> arc(angleStart = 90deg, angleEnd = 180deg, radius = cornerRadius)");
    if (h > 2 * r) lines.push("  |> line(end = [0, -(depth - 2 * cornerRadius)])");
    lines.push("  |> arc(angleStart = 180deg, angleEnd = 270deg, radius = cornerRadius)");
    if (w > 2 * r) lines.push("  |> line(end = [width - 2 * cornerRadius, 0])");
    lines.push("  |> close()");
  }
  lines.push("boardBlank = extrude(boardProfile, length = thickness)");
  const holes = [...profile.holes].sort((a, b) => a.id.localeCompare(b.id));
  holes.forEach((hole, index) => {
    lines.push(
      `hole${index + 1}Sketch = startSketchOn(XY)`,
      `hole${index + 1} = circle(hole${index + 1}Sketch, center = [${n(hole.xMm)}, ${n(hole.yMm)}], radius = ${n(hole.drillMm / 2)})`,
      "  |> extrude(length = thickness)",
    );
  });
  lines.push(
    holes.length
      ? `board = subtract(boardBlank, tools = [${holes.map((_, i) => `hole${i + 1}`).join(", ")}])`
      : "board = boardBlank",
    "board",
    "",
  );
  return lines.join("\n");
}

/** Inline preview uses declared substrate plus only explicitly supplied package heights. */
export function pcbAssemblyKcl(
  doc: PcbDoc,
  opts?: { zOffsetMm?: number; prefix?: string },
): string {
  const p = (opts?.prefix ?? "fpcb").replace(/[^A-Za-z0-9_]/g, "_");
  const prefix = /^[A-Za-z_]/.test(p) ? p : `pcb_${p}`;
  const z = opts?.zOffsetMm ?? 0;
  const boardKcl = pcbPartKcl(doc);
  const names = [...boardKcl.matchAll(/^([A-Za-z_][\w]*)\s*=/gm)].map((match) => match[1]!);
  const rename = new RegExp(`\\b(${names.join("|")})\\b`, "g");
  const blocks = [boardKcl.replace(rename, (name) => `${prefix}_${name}`)];
  if (z !== 0) blocks.push(`translate(${prefix}_board, z = ${n(z)}, global = true)`);
  const profile = pcbMechanicalProfile(doc);
  for (const [index, component] of profile.components.entries()) {
    if (index >= MAX_FOOTPRINT_BODIES) break;
    if (component.bodyHeightMm === undefined || component.zMm === undefined) continue;
    blocks.push(
      boxKcl(
        `${prefix}_body${index}`,
        component.widthMm,
        component.depthMm,
        component.bodyHeightMm,
        component.xMm,
        component.yMm,
        z + component.zMm,
        component.rotationDeg,
      ),
    );
  }
  if (profile.unknownHeightIds.length)
    blocks.push(
      `// UNVERIFIED: ${profile.unknownHeightIds.length} package heights are unknown; those bodies are omitted.`,
    );
  return blocks.join("\n\n") + "\n";
}

function boxKcl(
  name: string,
  width: number,
  depth: number,
  height: number,
  x: number,
  y: number,
  z: number,
  rotation: number,
): string {
  return [
    `${name}Sketch = startSketchOn(XY)`,
    `${name}Profile = startProfile(${name}Sketch, at = [${n(-width / 2)}, ${n(-depth / 2)}])`,
    `  |> line(end = [${n(width)}, 0])`,
    `  |> line(end = [0, ${n(depth)}])`,
    `  |> line(end = [${n(-width)}, 0])`,
    "  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])",
    "  |> close()",
    `${name} = extrude(${name}Profile, length = ${n(height)})`,
    `  |> rotate(axis = [0, 0, 1], angle = ${n(rotation)}deg, global = true)`,
    `  |> translate(x = ${n(x)}, y = ${n(y)}, z = ${n(z)}, global = true)`,
  ].join("\n");
}
