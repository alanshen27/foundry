/** Native build123d substrate from the same declared PCB geometry used by DRC. */
import type { PcbDoc } from "./doc";
import { pcbMechanicalProfile } from "./mechanical";
import { pcbCadPartName } from "./kcl";

const n = (value: number) => String(Number(value.toFixed(9)));
const MAX_FOOTPRINT_BODIES = 160;

export function pcbPythonPath(doc: PcbDoc): string {
  return `parts/${pcbCadPartName(doc).replace(/-/g, "_")}/main.py`;
}

export function pcbPartPython(doc: PcbDoc): string {
  const profile = pcbMechanicalProfile(doc);
  const { widthMm: w, heightMm: h, thicknessMm: t, cornerRadiusMm: r } = profile;
  if (
    ![w, h, t].every((v) => Number.isFinite(v) && v > 0) ||
    !Number.isFinite(r) ||
    r < 0 ||
    r > Math.min(w, h) / 2
  )
    throw new Error(`Invalid mechanical board dimensions: ${profile.boardId}`);
  const label = (doc.name?.trim() || profile.boardId).replace(/[\r\n]/g, " ");
  const lines = [
    `# LOCAL PCB substrate (${label}), millimetres.`,
    "# UNVERIFIED: declared outline, drills and package envelopes; fit requires review.",
    "from build123d import *",
    "",
    `width = ${n(w)}`,
    `depth = ${n(h)}`,
    `thickness = ${n(t)}`,
    `corner_radius = ${n(r)}`,
    "",
  ];
  const outline =
    r === 0
      ? "Rectangle(width, depth)"
      : r === Math.min(w, h) / 2
        ? w === h
          ? "Circle(width / 2)"
          : `SlotOverall(${w >= h ? "width, depth" : "depth, width, rotation=90"})`
        : "RectangleRounded(width, depth, corner_radius)";
  lines.push(`board = extrude(${outline}, amount=thickness)`);
  for (const hole of [...profile.holes].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(
      `board -= Pos(${n(hole.xMm)}, ${n(hole.yMm)}, 0) * Cylinder(${n(hole.drillMm / 2)}, thickness, align=(Align.CENTER, Align.CENTER, Align.MIN))`,
    );
  }
  lines.push(
    `board.label = "board"`,
    `# Soldermask green. Uncolored solids render as gray plastic in the assembly viewport.`,
    `board.color = Color(0.176, 0.353, 0.239)`,
  );
  const bodies = profile.components
    .filter(
      (component) =>
        typeof component.bodyHeightMm === "number" &&
        typeof component.zMm === "number" &&
        component.bodyHeightMm > 0,
    )
    .sort((a, b) => a.footprintId.localeCompare(b.footprintId))
    .slice(0, MAX_FOOTPRINT_BODIES);
  if (!bodies.length) {
    lines.push(`result = board`, `result.label = ${JSON.stringify(label)}`, "");
    return lines.join("\n");
  }
  lines.push("", "packages = []");
  for (const component of bodies) {
    const refDes = component.refDes.replace(/[\r\n]/g, " ");
    const place = `Pos(${n(component.xMm)}, ${n(component.yMm)}, ${n(component.zMm!)}) * Rot(0, 0, ${n(component.rotationDeg)})`;
    const glass = component.glass;
    const carrierHeight = glass
      ? component.bodyHeightMm! - glass.heightMm
      : component.bodyHeightMm!;
    lines.push(
      `pkg = ${place} * Box(${n(component.widthMm)}, ${n(component.depthMm)}, ${n(carrierHeight)}, align=(Align.CENTER, Align.CENTER, Align.MIN))`,
      `pkg.label = ${JSON.stringify(refDes)}`,
      `pkg.color = Color(0.09, 0.09, 0.1)`,
      `packages.append(pkg)`,
    );
    if (glass) {
      lines.push(
        `pkg = ${place} * Pos(${n(glass.xMm)}, ${n(glass.yMm)}, ${n(carrierHeight)}) * Box(${n(glass.wMm)}, ${n(glass.hMm)}, ${n(glass.heightMm)}, align=(Align.CENTER, Align.CENTER, Align.MIN))`,
        `pkg.label = ${JSON.stringify(`${refDes} glass`)}`,
        `pkg.color = Color(0.05, 0.08, 0.14)`,
        `packages.append(pkg)`,
      );
    }
  }
  if (profile.components.length > bodies.length) {
    lines.push(
      `# ${profile.components.length - bodies.length} packages omitted: unknown height or envelope limit.`,
    );
  }
  lines.push(
    `result = Compound(children=[board, *packages])`,
    `result.label = ${JSON.stringify(label)}`,
    "",
  );
  return lines.join("\n");
}
