/** Native build123d substrate from the same declared PCB geometry used by DRC. */
import type { PcbDoc } from "./doc";
import { pcbMechanicalProfile } from "./mechanical";
import { pcbCadPartName } from "./kcl";

const n = (value: number) => String(Number(value.toFixed(9)));

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
    "# UNVERIFIED: declared outline and drills; package clearances require review.",
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
  lines.push(`result = extrude(${outline}, amount=thickness)`);
  for (const hole of [...profile.holes].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(
      `result -= Pos(${n(hole.xMm)}, ${n(hole.yMm)}, 0) * Cylinder(${n(hole.drillMm / 2)}, thickness, align=(Align.CENTER, Align.CENTER, Align.MIN))`,
    );
  }
  lines.push(`result.label = ${JSON.stringify(label)}`, "");
  return lines.join("\n");
}
