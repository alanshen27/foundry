/**
 * Assembly helpers.
 *
 * Preferred path: Zoo multi-file Text-to-CAD iteration reuses existing part
 * files and rewrites assembly/product.kcl (see assembleProductWithZooMl).
 * The bbox / pack helpers below remain for tests and MCP orientation probes.
 */
import type { CadBoundingBox } from "./port";
import type { CadComponent } from "./port";
import type { CadPort } from "./port";
import { partModuleAlias, toZooKclPath } from "./doc";

/**
 * Minimal product.kcl seed: import each part, emit aliases with no poses.
 * Zoo multi-file iteration then positions them — keeps part geometry attached.
 */
export function seedAssemblyKcl(parts: Array<Pick<CadComponent, "name" | "path">>): string {
  const lines: string[] = [
    "// Product assembly (mm) — poses written by Zoo multi-file Text-to-CAD iteration.",
    "// Parts are attached as project files; only this assembly file should gain translate/rotate.",
    "",
  ];
  const aliases: string[] = [];
  for (const part of parts) {
    const alias = partModuleAlias(part);
    aliases.push(alias);
    lines.push(`import "${toZooKclPath(part.path)}" as ${alias}`);
  }
  lines.push("");
  for (const alias of aliases) {
    lines.push(alias);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** Default prompt for assembling attached part files into product.kcl. */
export function defaultAssemblyIteratePrompt(partPaths: string[]): string {
  const list = partPaths.map((p) => `- ${toZooKclPath(p)}`).join("\n");
  return [
    "Assemble the attached existing KCL parts into a coherent product assembly.",
    "Reuse the part modules as-is (import …/main.kcl). Do not regenerate part geometry unless an import path must change.",
    "Orient each part for real-world use and position them with realistic mates / contact — not an exploded side-by-side pack.",
    "Write translate/rotate only in the assembly file. Units are millimetres.",
    "Parts:",
    list,
  ].join("\n");
}

export const ASSEMBLY_LAYOUT_GAP_MM = 8;

/** Degrees about local axes — orthogonal face-down set + yaw for X-alignment. */
export type AssemblyRotationDeg = { roll: number; pitch: number; yaw: number };

export type AssemblyPlacement = {
  path: string;
  alias: string;
  translate: { x: number; y: number; z: number };
  rotate: AssemblyRotationDeg;
  bbox: CadBoundingBox;
};

const ZERO_ROT: AssemblyRotationDeg = { roll: 0, pitch: 0, yaw: 0 };

/** Face-down candidates (which axis points up), then yaw 0/90 for longest-edge-on-X. */
export const ORIENTATION_CANDIDATES: AssemblyRotationDeg[] = [
  { roll: 0, pitch: 0, yaw: 0 },
  { roll: 0, pitch: 0, yaw: 90 },
  { roll: 90, pitch: 0, yaw: 0 },
  { roll: 90, pitch: 0, yaw: 90 },
  { roll: 180, pitch: 0, yaw: 0 },
  { roll: 180, pitch: 0, yaw: 90 },
  { roll: 270, pitch: 0, yaw: 0 },
  { roll: 270, pitch: 0, yaw: 90 },
  { roll: 0, pitch: 90, yaw: 0 },
  { roll: 0, pitch: 90, yaw: 90 },
  { roll: 0, pitch: 270, yaw: 0 },
  { roll: 0, pitch: 270, yaw: 90 },
];

/** Higher is better: flat on XY, then longest side along +X. */
export function scoreOrientedBbox(bbox: CadBoundingBox): number {
  const { x: dx, y: dy, z: dz } = bbox.dimensions;
  const footprint = dx * dy;
  const xBias = Math.abs(dx - dy) < 1e-6 ? 0 : dx >= dy ? 1 : -1;
  return footprint * 1_000_000 - dz * 1_000 + xBias * 10;
}

export function isIdentityRotation(r: AssemblyRotationDeg): boolean {
  return r.roll === 0 && r.pitch === 0 && r.yaw === 0;
}

/**
 * Wrap part KCL so Zoo MCP can bbox a rotated instance.
 * Prefers `rotate(name, …)` when the last statement assigns a binding.
 */
export function kclWithOrientation(kcl: string, rot: AssemblyRotationDeg): string {
  const trimmed = kcl.trimEnd();
  if (isIdentityRotation(rot)) return trimmed;

  const rotArgs = [
    rot.roll !== 0 ? `roll = ${rot.roll}deg` : null,
    rot.pitch !== 0 ? `pitch = ${rot.pitch}deg` : null,
    rot.yaw !== 0 ? `yaw = ${rot.yaw}deg` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@("));
  const last = lines[lines.length - 1] ?? "";
  const assign = /^([A-Za-z_][\w]*)\s*=/.exec(last);
  if (assign) {
    return `${trimmed}\nrotate(${assign[1]}, ${rotArgs})\n`;
  }
  return `${trimmed}\n  |> rotate(${rotArgs})\n`;
}

/**
 * Ask Zoo MCP which orthogonal orientation sits flattest. Falls back to identity
 * bbox if every candidate fails.
 */
export async function chooseZooOrientation(
  cad: Pick<CadPort, "boundingBoxKcl">,
  partKcl: string,
  unit = "mm",
): Promise<{ rotate: AssemblyRotationDeg; bbox: CadBoundingBox } | null> {
  let best: { rotate: AssemblyRotationDeg; bbox: CadBoundingBox; score: number } | null =
    null;

  for (const rot of ORIENTATION_CANDIDATES) {
    const code = kclWithOrientation(partKcl, rot);
    const box = await cad.boundingBoxKcl({ code, unit });
    if (!box.ok) continue;
    const score = scoreOrientedBbox(box.data);
    if (!best || score > best.score) {
      best = { rotate: rot, bbox: box.data, score };
    }
  }

  return best ? { rotate: best.rotate, bbox: best.bbox } : null;
}

export function planAssemblyPlacements(
  parts: Array<{
    component: CadComponent;
    bbox: CadBoundingBox;
    rotate?: AssemblyRotationDeg;
  }>,
): AssemblyPlacement[] {
  let cursorX = 0;
  const out: AssemblyPlacement[] = [];

  for (const { component, bbox, rotate = ZERO_ROT } of parts) {
    const alias = partModuleAlias(component);
    // Shift so the oriented bbox centre lands at (cursorX + halfWidth, 0, halfHeight).
    // Bottoms sit on Z=0; parts pack along +X with a clearance gap.
    const x = cursorX + bbox.dimensions.x / 2 - bbox.center.x;
    const y = -bbox.center.y;
    const z = bbox.dimensions.z / 2 - bbox.center.z;
    out.push({
      path: component.path,
      alias,
      translate: {
        x: round3(x),
        y: round3(y),
        z: round3(z),
      },
      rotate: { ...rotate },
      bbox,
    });
    cursorX += bbox.dimensions.x + ASSEMBLY_LAYOUT_GAP_MM;
  }

  return out;
}

function formatRotateCall(alias: string, rot: AssemblyRotationDeg): string {
  const args = [
    rot.roll !== 0 ? `roll = ${rot.roll}deg` : null,
    rot.pitch !== 0 ? `pitch = ${rot.pitch}deg` : null,
    rot.yaw !== 0 ? `yaw = ${rot.yaw}deg` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `rotate(${alias}, ${args})`;
}

/** Rewrite product.kcl from Zoo-oriented placements. */
export function renderAssemblyKcl(placements: AssemblyPlacement[]): string {
  const lines: string[] = [
    "// Product assembly (mm) — poses from Zoo MCP oriented bounding boxes.",
    "// Each part is rotated to sit flattest (Zoo-measured), then translated",
    "// so bottoms land on Z=0. Subdirectory imports use …/main.kcl.",
    "",
  ];

  for (const p of placements) {
    lines.push(`import "${toZooKclPath(p.path)}" as ${p.alias}`);
  }
  lines.push("");

  for (const p of placements) {
    const { x, y, z } = p.translate;
    const hasRotate = !isIdentityRotation(p.rotate);
    const hasTranslate = !(x === 0 && y === 0 && z === 0);

    if (!hasRotate && !hasTranslate) {
      lines.push(p.alias);
    } else if (hasRotate && hasTranslate) {
      lines.push(
        `translate(${formatRotateCall(p.alias, p.rotate)}, x = ${x}, y = ${y}, z = ${z})`,
      );
    } else if (hasRotate) {
      lines.push(formatRotateCall(p.alias, p.rotate));
    } else {
      lines.push(`translate(${p.alias}, x = ${x}, y = ${y}, z = ${z})`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
