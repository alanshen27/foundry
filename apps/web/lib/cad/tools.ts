/**
 * CAD feature tools → Zoo KCL. Toolbar applies these to main.kcl; the engine
 * re-executes. Ops match KCL std (extrude, revolve, fillet, mirror3d, …).
 */
import { parseCadParams, setCadParam } from "./params";

export type CadToolGroup =
  | "sketch"
  | "construct"
  | "create"
  | "direct"
  | "feature"
  | "modify"
  | "transform"
  | "pattern"
  | "boolean";

export type CadToolField =
  | {
      key: string;
      label: string;
      type: "number";
      default: number;
      unit?: string;
      min?: number;
      step?: number;
    }
  | {
      key: string;
      label: string;
      type: "select";
      default: string;
      options: { value: string; label: string }[];
    }
  | { key: string; label: string; type: "text"; default: string; placeholder?: string }
  | { key: string; label: string; type: "boolean"; default: boolean };

export type CadToolValues = Record<string, number | string | boolean>;

export type CadToolDef = {
  id: string;
  label: string;
  group: CadToolGroup;
  description: string;
  /** Needs an existing solid in the script. */
  requiresSolid?: boolean;
  fields: CadToolField[];
};

export type ApplyToolResult = {
  script: string;
  /** Solid / sketch binding the tool produced or modified. */
  target: string | null;
};

export type ApplyCadToolOptions = {
  /** Explicit solid chosen in the feature history. Falls back to the last solid. */
  targetSolid?: string | null;
};

const PLANE_OPTIONS = [
  { value: "XY", label: "XY (top)" },
  { value: "XZ", label: "XZ (front)" },
  { value: "YZ", label: "YZ (right)" },
  { value: "-XY", label: "−XY" },
  { value: "-XZ", label: "−XZ" },
  { value: "-YZ", label: "−YZ" },
];

const AXIS_OPTIONS = [
  { value: "X", label: "X" },
  { value: "Y", label: "Y" },
  { value: "Z", label: "Z" },
];

const FACE_OPTIONS = [
  { value: "top", label: "Top (+Z)" },
  { value: "bottom", label: "Bottom (−Z)" },
  { value: "right", label: "Right (+X)" },
  { value: "left", label: "Left (−X)" },
  { value: "front", label: "Front (−Y)" },
  { value: "back", label: "Back (+Y)" },
];

const MIRROR_PLANE_OPTIONS = [
  { value: "XY", label: "XY" },
  { value: "XZ", label: "XZ" },
  { value: "YZ", label: "YZ" },
];

const SOLID_OPS =
  /\b(extrude|revolve|loft|sweep|fillet|chamfer|shell|union|intersect|subtract|mirror3d|patternLinear3d|patternTransform|translate|rotate|scale|clone)\b/;
const SKETCH_OPS = /\b(startSketchOn|startProfile|circle|polygon)\b/;

/** Next unused `prefix001`-style binding name. */
export function nextBinding(script: string, prefix: string): string {
  const re = new RegExp(`\\b${prefix}(\\d+)\\b`, "g");
  let max = 0;
  for (const m of script.matchAll(re)) {
    max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function gatherBlock(lines: string[], start: number): string {
  let block = lines[start] ?? "";
  for (let j = start + 1; j < lines.length; j++) {
    const n = lines[j]!.trim();
    if (!n || n.startsWith("//")) continue;
    if (n.startsWith("|>")) block += `\n${lines[j]}`;
    else break;
  }
  return block;
}

/** Last solid-like binding (extrude / transform / body*). */
export function findLastSolid(script: string): string | null {
  const lines = script.split("\n");
  let last: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    const m = /^([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(t);
    if (!m) continue;
    const [, name, rhs] = m as unknown as [string, string, string];
    if (/^(-?\d|true|false|")/.test(rhs)) continue;
    const block = gatherBlock(lines, i);
    if (SOLID_OPS.test(block) || /^(body|part|solid)/i.test(name)) {
      last = name;
    }
  }
  return last;
}

/** Last sketch binding (startSketchOn / profile without solid op). */
export function findLastSketch(script: string): string | null {
  const lines = script.split("\n");
  let last: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    const m = /^([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(t);
    if (!m) continue;
    const [, name, rhs] = m as unknown as [string, string, string];
    if (/^(-?\d|true|false|")/.test(rhs)) continue;
    const block = gatherBlock(lines, i);
    if (SKETCH_OPS.test(block) && !SOLID_OPS.test(block)) {
      last = name;
    }
  }
  return last;
}

function num(values: CadToolValues, key: string, fallback: number): number {
  const v = values[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(values: CadToolValues, key: string, fallback: string): string {
  const v = values[key];
  return typeof v === "string" && v ? v : fallback;
}

function bool(values: CadToolValues, key: string, fallback: boolean): boolean {
  const v = values[key];
  return typeof v === "boolean" ? v : fallback;
}

/** Insert or update top-level numeric/bool params before the first modeling line. */
export function upsertParams(script: string, params: CadToolValues): string {
  let next = script;
  const existing = new Set(parseCadParams(next).map((p) => p.name));
  const additions: string[] = [];
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === "string") continue;
    if (existing.has(name)) {
      next = setCadParam(next, name, value);
    } else {
      additions.push(`${name} = ${typeof value === "boolean" ? String(value) : String(value)}`);
    }
  }
  if (!additions.length) return next;

  const lines = next.split("\n");
  let insertAt = 0;
  let seenContent = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t || t.startsWith("//")) {
      if (!seenContent) insertAt = i + 1;
      continue;
    }
    const isParam = /^[A-Za-z_]\w*\s*=\s*(-?\d|true|false|")/.test(t);
    if (isParam) {
      seenContent = true;
      insertAt = i + 1;
      continue;
    }
    break;
  }
  lines.splice(insertAt, 0, ...additions);
  return lines.join("\n");
}

export type PushPullFace = "top" | "bottom" | "right" | "left" | "front" | "back";

/**
 * Direct-edit a driving dimension instead of stacking another body transform.
 * The KCL feature history remains parametric and downstream features rebuild.
 */
export function pushPullFace(
  script: string,
  face: PushPullFace,
  distance: number,
): { script: string; parameter: string; value: number } {
  if (!Number.isFinite(distance) || distance === 0) {
    throw new Error("Enter a non-zero push/pull distance.");
  }
  const params = parseCadParams(script).filter(
    (param): param is typeof param & { value: number } => typeof param.value === "number",
  );
  const candidates =
    face === "top" || face === "bottom"
      ? [/height|extrude|length/i]
      : face === "right" || face === "left"
        ? [/width|radius/i]
        : [/depth|radius/i];
  const parameter = candidates
    .map((pattern) => [...params].reverse().find((item) => pattern.test(item.name)))
    .find(Boolean);
  if (!parameter) {
    throw new Error(
      `This ${face} face has no editable driving dimension. Create a Box, Cylinder, or Extrude first.`,
    );
  }
  const signedDistance =
    face === "bottom" || face === "left" || face === "back" ? -distance : distance;
  const value = Math.max(0.1, Math.round((parameter.value + signedDistance) * 1000) / 1000);
  return {
    script: setCadParam(script, parameter.name, value),
    parameter: parameter.name,
    value,
  };
}

function appendBlock(script: string, block: string): string {
  const trimmed = script.replace(/\s+$/, "");
  return `${trimmed}\n\n${block.trim()}\n`;
}

/**
 * Append `|> …` ops onto an existing solid binding (KCL vars are immutable, so
 * we extend the original pipeline instead of reassigning).
 */
export function pipeOntoSolid(script: string, solidName: string, pipeLines: string): string {
  const lines = script.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`^${solidName}\\s*=`).test(lines[i]!.trim())) start = i;
  }
  if (start < 0) {
    const body = nextBinding(script, "body");
    return appendBlock(script, `${body} = ${solidName}\n${pipeLines.trim()}`);
  }
  let end = start;
  for (let j = start + 1; j < lines.length; j++) {
    const n = lines[j]!.trim();
    if (!n || n.startsWith("//")) break;
    if (n.startsWith("|>")) end = j;
    else break;
  }
  const extras = pipeLines
    .trim()
    .split("\n")
    .map((l) => {
      const t = l.trim();
      return t.startsWith("|>") ? `  ${t}` : `  ${t}`;
    });
  lines.splice(end + 1, 0, ...extras);
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

function axisVec(axis: string): string {
  if (axis === "X") return "[1, 0, 0]";
  if (axis === "Y") return "[0, 1, 0]";
  return "[0, 0, 1]";
}

export const CAD_TOOLS: CadToolDef[] = [
  {
    id: "plane",
    label: "Plane",
    group: "sketch",
    description: "Start a sketch on a standard plane (XY / XZ / YZ).",
    fields: [
      { key: "plane", label: "Plane", type: "select", default: "XY", options: PLANE_OPTIONS },
    ],
  },
  {
    id: "rectangle",
    label: "Rectangle",
    group: "sketch",
    description: "Centered rectangle profile on a plane.",
    fields: [
      { key: "plane", label: "Plane", type: "select", default: "XY", options: PLANE_OPTIONS },
      { key: "width", label: "Width", type: "number", default: 60, unit: "mm", min: 0.1, step: 1 },
      { key: "depth", label: "Depth", type: "number", default: 40, unit: "mm", min: 0.1, step: 1 },
    ],
  },
  {
    id: "circle",
    label: "Circle",
    group: "sketch",
    description: "Circle profile on a plane.",
    fields: [
      { key: "plane", label: "Plane", type: "select", default: "XY", options: PLANE_OPTIONS },
      {
        key: "radius",
        label: "Radius",
        type: "number",
        default: 20,
        unit: "mm",
        min: 0.1,
        step: 0.5,
      },
    ],
  },
  {
    id: "polygonSketch",
    label: "Polygon",
    group: "sketch",
    description: "Regular closed polygon profile for later extrude, revolve, or loft operations.",
    fields: [
      { key: "plane", label: "Plane", type: "select", default: "XY", options: PLANE_OPTIONS },
      { key: "sides", label: "Sides", type: "number", default: 6, min: 3, step: 1 },
      { key: "radius", label: "Radius", type: "number", default: 20, unit: "mm", min: 0.1 },
    ],
  },
  {
    id: "slotSketch",
    label: "Center slot",
    group: "sketch",
    description: "Closed stadium profile defined by center length and slot width.",
    fields: [
      { key: "plane", label: "Plane", type: "select", default: "XY", options: PLANE_OPTIONS },
      { key: "length", label: "Center length", type: "number", default: 36, unit: "mm", min: 0.1 },
      { key: "width", label: "Slot width", type: "number", default: 12, unit: "mm", min: 0.1 },
    ],
  },
  {
    id: "offsetPlane",
    label: "Offset plane",
    group: "construct",
    description:
      "Create a construction plane parallel to a standard origin plane and start a sketch.",
    fields: [
      { key: "plane", label: "Base plane", type: "select", default: "XY", options: PLANE_OPTIONS },
      { key: "offset", label: "Offset", type: "number", default: 20, unit: "mm", step: 1 },
    ],
  },
  {
    id: "box",
    label: "Box",
    group: "create",
    description: "Rectangular prism (sketch + extrude).",
    fields: [
      { key: "plane", label: "Plane", type: "select", default: "XY", options: PLANE_OPTIONS },
      { key: "width", label: "Width", type: "number", default: 40, unit: "mm", min: 0.1, step: 1 },
      { key: "depth", label: "Depth", type: "number", default: 40, unit: "mm", min: 0.1, step: 1 },
      {
        key: "height",
        label: "Height",
        type: "number",
        default: 40,
        unit: "mm",
        min: 0.1,
        step: 1,
      },
    ],
  },
  {
    id: "cylinder",
    label: "Cylinder",
    group: "create",
    description: "Cylinder (circle + extrude).",
    fields: [
      { key: "plane", label: "Plane", type: "select", default: "XY", options: PLANE_OPTIONS },
      {
        key: "radius",
        label: "Radius",
        type: "number",
        default: 15,
        unit: "mm",
        min: 0.1,
        step: 0.5,
      },
      {
        key: "height",
        label: "Height",
        type: "number",
        default: 40,
        unit: "mm",
        min: 0.1,
        step: 1,
      },
    ],
  },
  {
    id: "sphere",
    label: "Sphere",
    group: "create",
    description: "Parametric sphere made by revolving a semicircular profile.",
    fields: [
      {
        key: "radius",
        label: "Radius",
        type: "number",
        default: 20,
        unit: "mm",
        min: 0.1,
        step: 0.5,
      },
    ],
  },
  {
    id: "prism",
    label: "Prism",
    group: "create",
    description: "Regular polygon prism with editable side count, radius, and height.",
    fields: [
      { key: "sides", label: "Sides", type: "number", default: 6, min: 3, step: 1 },
      { key: "radius", label: "Radius", type: "number", default: 20, unit: "mm", min: 0.1 },
      { key: "height", label: "Height", type: "number", default: 30, unit: "mm", min: 0.1 },
    ],
  },
  {
    id: "cone",
    label: "Cone",
    group: "create",
    description: "Cone or frustum lofted between two circular sections.",
    fields: [
      { key: "baseRadius", label: "Base R", type: "number", default: 22, unit: "mm", min: 0.1 },
      { key: "topRadius", label: "Top R", type: "number", default: 4, unit: "mm", min: 0.1 },
      { key: "height", label: "Height", type: "number", default: 40, unit: "mm", min: 0.1 },
    ],
  },
  {
    id: "torus",
    label: "Torus",
    group: "create",
    description: "Ring solid made by revolving a circular section.",
    fields: [
      { key: "majorRadius", label: "Major R", type: "number", default: 24, unit: "mm", min: 0.2 },
      { key: "minorRadius", label: "Tube R", type: "number", default: 6, unit: "mm", min: 0.1 },
    ],
  },
  {
    id: "tube",
    label: "Tube",
    group: "create",
    description: "Hollow cylinder with editable outside radius, wall, and height.",
    fields: [
      { key: "outerRadius", label: "Outer R", type: "number", default: 18, unit: "mm", min: 0.2 },
      { key: "wall", label: "Wall", type: "number", default: 3, unit: "mm", min: 0.1 },
      { key: "height", label: "Height", type: "number", default: 40, unit: "mm", min: 0.1 },
    ],
  },
  {
    id: "wedge",
    label: "Wedge",
    group: "create",
    description: "Triangular wedge for brackets, ramps, and supports.",
    fields: [
      { key: "width", label: "Width", type: "number", default: 40, unit: "mm", min: 0.1 },
      { key: "height", label: "Height", type: "number", default: 25, unit: "mm", min: 0.1 },
      { key: "depth", label: "Depth", type: "number", default: 30, unit: "mm", min: 0.1 },
    ],
  },
  {
    id: "ellipsoid",
    label: "Ellipsoid",
    group: "create",
    description: "Smooth form with independent X, Y, and Z radii.",
    fields: [
      { key: "xRadius", label: "X radius", type: "number", default: 28, unit: "mm", min: 0.1 },
      { key: "yRadius", label: "Y radius", type: "number", default: 20, unit: "mm", min: 0.1 },
      { key: "zRadius", label: "Z radius", type: "number", default: 14, unit: "mm", min: 0.1 },
    ],
  },
  {
    id: "capsule",
    label: "Capsule",
    group: "create",
    description: "Extrude a slot profile into a rounded-end enclosure, rail, or link.",
    fields: [
      { key: "length", label: "Center length", type: "number", default: 42, unit: "mm", min: 0.1 },
      { key: "width", label: "Width", type: "number", default: 16, unit: "mm", min: 0.1 },
      { key: "height", label: "Height", type: "number", default: 8, unit: "mm", min: 0.1 },
    ],
  },
  {
    id: "hexNut",
    label: "Hex nut",
    group: "create",
    description: "Parametric six-sided fastener body with a centered through bore.",
    fields: [
      {
        key: "outerRadius",
        label: "Outer radius",
        type: "number",
        default: 10,
        unit: "mm",
        min: 0.2,
      },
      { key: "boreRadius", label: "Bore radius", type: "number", default: 4, unit: "mm", min: 0.1 },
      { key: "height", label: "Height", type: "number", default: 6, unit: "mm", min: 0.1 },
    ],
  },
  {
    id: "pushPull",
    label: "Push / Pull",
    group: "direct",
    description: "Move a principal face by editing its driving dimension.",
    requiresSolid: true,
    fields: [
      { key: "face", label: "Face", type: "select", default: "top", options: FACE_OPTIONS },
      { key: "distance", label: "Distance", type: "number", default: 5, unit: "mm", step: 1 },
    ],
  },
  {
    id: "stretch",
    label: "Form stretch",
    group: "direct",
    description: "Stretch or compress the current body along one axis.",
    requiresSolid: true,
    fields: [
      { key: "axis", label: "Axis", type: "select", default: "Z", options: AXIS_OPTIONS },
      { key: "factor", label: "Factor", type: "number", default: 1.15, min: 0.01, step: 0.05 },
    ],
  },
  {
    id: "extrude",
    label: "Extrude",
    group: "feature",
    description: "Extrude the last sketch, or create a box if none exists.",
    fields: [
      {
        key: "length",
        label: "Length",
        type: "number",
        default: 20,
        unit: "mm",
        min: 0.1,
        step: 1,
      },
      { key: "symmetric", label: "Symmetric", type: "boolean", default: false },
    ],
  },
  {
    id: "revolve",
    label: "Revolve",
    group: "feature",
    description: "Revolve a profile around an axis (creates a lathed solid).",
    fields: [
      { key: "plane", label: "Plane", type: "select", default: "XZ", options: PLANE_OPTIONS },
      {
        key: "radius",
        label: "Outer R",
        type: "number",
        default: 25,
        unit: "mm",
        min: 0.1,
        step: 1,
      },
      { key: "inner", label: "Inner R", type: "number", default: 10, unit: "mm", min: 0, step: 1 },
      {
        key: "height",
        label: "Height",
        type: "number",
        default: 20,
        unit: "mm",
        min: 0.1,
        step: 1,
      },
      { key: "axis", label: "Axis", type: "select", default: "Y", options: AXIS_OPTIONS },
      { key: "angle", label: "Angle", type: "number", default: 360, unit: "deg", min: 1, step: 5 },
    ],
  },
  {
    id: "sweep",
    label: "Sweep",
    group: "feature",
    description: "Sweep a circular section along a straight and curved path.",
    fields: [
      { key: "radius", label: "Profile R", type: "number", default: 3, unit: "mm", min: 0.1 },
      { key: "length", label: "Run", type: "number", default: 40, unit: "mm", min: 0.1 },
      { key: "bend", label: "Bend X", type: "number", default: 12, unit: "mm" },
      { key: "rise", label: "Rise", type: "number", default: 18, unit: "mm" },
    ],
  },
  {
    id: "loft",
    label: "Loft",
    group: "feature",
    description: "Blend between two parametric circular sections.",
    fields: [
      { key: "startRadius", label: "Start R", type: "number", default: 20, unit: "mm", min: 0.1 },
      { key: "endRadius", label: "End R", type: "number", default: 10, unit: "mm", min: 0.1 },
      { key: "height", label: "Height", type: "number", default: 40, unit: "mm", min: 0.1 },
    ],
  },
  {
    id: "twistExtrude",
    label: "Twist",
    group: "feature",
    description: "Extrude a polygon while twisting it through a controlled angle.",
    fields: [
      { key: "radius", label: "Radius", type: "number", default: 18, unit: "mm", min: 0.1 },
      { key: "sides", label: "Sides", type: "number", default: 6, min: 3, step: 1 },
      { key: "height", label: "Height", type: "number", default: 50, unit: "mm", min: 0.1 },
      { key: "angle", label: "Twist", type: "number", default: 120, unit: "deg", step: 10 },
    ],
  },
  {
    id: "draftExtrude",
    label: "Draft",
    group: "feature",
    description: "Extrude a profile with tapered side walls.",
    fields: [
      { key: "radius", label: "Radius", type: "number", default: 20, unit: "mm", min: 0.1 },
      { key: "height", label: "Height", type: "number", default: 35, unit: "mm", min: 0.1 },
      { key: "angle", label: "Draft", type: "number", default: 8, unit: "deg", step: 1 },
    ],
  },
  {
    id: "fillet",
    label: "Fillet",
    group: "modify",
    description: "Round tagged / end edges of the last solid.",
    requiresSolid: true,
    fields: [
      {
        key: "radius",
        label: "Radius",
        type: "number",
        default: 2,
        unit: "mm",
        min: 0.1,
        step: 0.5,
      },
    ],
  },
  {
    id: "chamfer",
    label: "Chamfer",
    group: "modify",
    description: "Bevel end edges of the last solid.",
    requiresSolid: true,
    fields: [
      {
        key: "length",
        label: "Length",
        type: "number",
        default: 2,
        unit: "mm",
        min: 0.1,
        step: 0.5,
      },
    ],
  },
  {
    id: "shell",
    label: "Shell",
    group: "modify",
    description: "Hollow the last solid, open on END face.",
    requiresSolid: true,
    fields: [
      {
        key: "thickness",
        label: "Thickness",
        type: "number",
        default: 2,
        unit: "mm",
        min: 0.1,
        step: 0.5,
      },
    ],
  },
  {
    id: "hole",
    label: "Hole",
    group: "modify",
    description: "Cut a circular hole through the last solid (END face).",
    requiresSolid: true,
    fields: [
      {
        key: "diameter",
        label: "Diameter",
        type: "number",
        default: 8,
        unit: "mm",
        min: 0.1,
        step: 0.5,
      },
      { key: "depth", label: "Depth", type: "number", default: 50, unit: "mm", min: 0.1, step: 1 },
    ],
  },
  {
    id: "appearance",
    label: "Appearance",
    group: "modify",
    description: "Apply body color, metalness, roughness, and opacity.",
    requiresSolid: true,
    fields: [
      { key: "color", label: "Color", type: "text", default: "#ff6b2c", placeholder: "#RRGGBB" },
      { key: "metalness", label: "Metal", type: "number", default: 0, unit: "%", min: 0, step: 5 },
      { key: "roughness", label: "Rough", type: "number", default: 50, unit: "%", min: 0, step: 5 },
      {
        key: "opacity",
        label: "Opacity",
        type: "number",
        default: 100,
        unit: "%",
        min: 0,
        step: 5,
      },
    ],
  },
  {
    id: "mirror",
    label: "Mirror",
    group: "transform",
    description: "Mirror the last solid across a plane.",
    requiresSolid: true,
    fields: [
      {
        key: "plane",
        label: "Across",
        type: "select",
        default: "YZ",
        options: MIRROR_PLANE_OPTIONS,
      },
    ],
  },
  {
    id: "rotate",
    label: "Rotate",
    group: "transform",
    description: "Rotate the last solid (yaw / pitch / roll).",
    requiresSolid: true,
    fields: [
      { key: "yaw", label: "Yaw", type: "number", default: 45, unit: "deg", step: 5 },
      { key: "pitch", label: "Pitch", type: "number", default: 0, unit: "deg", step: 5 },
      { key: "roll", label: "Roll", type: "number", default: 0, unit: "deg", step: 5 },
    ],
  },
  {
    id: "translate",
    label: "Move",
    group: "transform",
    description: "Translate the last solid.",
    requiresSolid: true,
    fields: [
      { key: "x", label: "X", type: "number", default: 20, unit: "mm", step: 1 },
      { key: "y", label: "Y", type: "number", default: 0, unit: "mm", step: 1 },
      { key: "z", label: "Z", type: "number", default: 0, unit: "mm", step: 1 },
    ],
  },
  {
    id: "scale",
    label: "Scale",
    group: "transform",
    description: "Scale the last solid.",
    requiresSolid: true,
    fields: [
      { key: "x", label: "X", type: "number", default: 1, min: 0.01, step: 0.1 },
      { key: "y", label: "Y", type: "number", default: 1, min: 0.01, step: 0.1 },
      { key: "z", label: "Z", type: "number", default: 1, min: 0.01, step: 0.1 },
    ],
  },
  {
    id: "duplicate",
    label: "Duplicate",
    group: "transform",
    description: "Clone the current body and place the copy at an XYZ offset.",
    requiresSolid: true,
    fields: [
      { key: "x", label: "X", type: "number", default: 30, unit: "mm", step: 1 },
      { key: "y", label: "Y", type: "number", default: 0, unit: "mm", step: 1 },
      { key: "z", label: "Z", type: "number", default: 0, unit: "mm", step: 1 },
    ],
  },
  {
    id: "patternLinear",
    label: "Linear pattern",
    group: "pattern",
    description: "Repeat the last solid along an axis.",
    requiresSolid: true,
    fields: [
      { key: "instances", label: "Count", type: "number", default: 3, min: 2, step: 1 },
      {
        key: "distance",
        label: "Spacing",
        type: "number",
        default: 50,
        unit: "mm",
        min: 0.1,
        step: 1,
      },
      { key: "axis", label: "Axis", type: "select", default: "X", options: AXIS_OPTIONS },
    ],
  },
  {
    id: "patternCircular",
    label: "Circular pattern",
    group: "pattern",
    description: "Repeat the last solid around Z.",
    requiresSolid: true,
    fields: [
      { key: "instances", label: "Count", type: "number", default: 4, min: 2, step: 1 },
      {
        key: "arcDegrees",
        label: "Arc",
        type: "number",
        default: 360,
        unit: "deg",
        min: 1,
        step: 15,
      },
    ],
  },
  {
    id: "union",
    label: "Union",
    group: "boolean",
    description: "Boolean-union the two most recent solids.",
    requiresSolid: true,
    fields: [],
  },
  {
    id: "subtract",
    label: "Subtract",
    group: "boolean",
    description: "Subtract the newest solid from the previous one.",
    requiresSolid: true,
    fields: [],
  },
  {
    id: "intersect",
    label: "Intersect",
    group: "boolean",
    description: "Keep only the overlap of the two most recent solids.",
    requiresSolid: true,
    fields: [],
  },
];

export const CAD_TOOL_GROUPS: { id: CadToolGroup; label: string }[] = [
  { id: "sketch", label: "Sketch" },
  { id: "construct", label: "Construct" },
  { id: "create", label: "Create" },
  { id: "direct", label: "Direct" },
  { id: "feature", label: "Feature" },
  { id: "modify", label: "Modify" },
  { id: "transform", label: "Transform" },
  { id: "pattern", label: "Pattern" },
  { id: "boolean", label: "Boolean" },
];

export function getCadTool(id: string): CadToolDef | undefined {
  return CAD_TOOLS.find((t) => t.id === id);
}

export function defaultValues(tool: CadToolDef): CadToolValues {
  const values: CadToolValues = {};
  for (const f of tool.fields) values[f.key] = f.default;
  return values;
}

/** Solid-like bindings in source order (extrude / body* / part*). */
export function listCadSolids(script: string): string[] {
  const lines = script.split("\n");
  const solids: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    const m = /^([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(t);
    if (!m) continue;
    const [, name, rhs] = m as unknown as [string, string, string];
    if (/^(-?\d|true|false|")/.test(rhs)) continue;
    const block = gatherBlock(lines, i);
    if (SOLID_OPS.test(block) || /^(body|part|solid)/i.test(name)) {
      solids.push(name);
    }
  }
  return solids;
}

const listSolids = listCadSolids;

/** Apply a CAD tool; returns updated KCL. */
export function applyCadTool(
  script: string,
  toolId: string,
  values: CadToolValues,
  options?: ApplyCadToolOptions,
): ApplyToolResult {
  const tool = getCadTool(toolId);
  if (!tool) return { script, target: null };

  const solids = listSolids(script);
  const requested = options?.targetSolid;
  const solid = requested && solids.includes(requested) ? requested : (solids.at(-1) ?? null);
  if (tool.requiresSolid && !solid) {
    throw new Error(`Select or create a solid before using ${tool.label}.`);
  }

  switch (toolId) {
    case "plane": {
      const plane = str(values, "plane", "XY");
      const name = nextBinding(script, "sketch");
      return {
        script: appendBlock(script, `${name} = startSketchOn(${plane})`),
        target: name,
      };
    }
    case "rectangle": {
      const plane = str(values, "plane", "XY");
      const wName = nextBinding(script, "rectWidth");
      const dName = nextBinding(script, "rectDepth");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const w = num(values, "width", 60);
      const d = num(values, "depth", 40);
      let next = upsertParams(script, { [wName]: w, [dName]: d });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(${plane})
${profile} = startProfile(${sketch}, at = [-${wName} / 2, -${dName} / 2])
  |> line(end = [${wName}, 0], tag = $edge)
  |> line(end = [0, ${dName}])
  |> line(end = [-${wName}, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`,
      );
      return { script: next, target: profile };
    }
    case "circle": {
      const plane = str(values, "plane", "XY");
      const rName = nextBinding(script, "circleRadius");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const r = num(values, "radius", 20);
      let next = upsertParams(script, { [rName]: r });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(${plane})
${profile} = circle(${sketch}, center = [0, 0], radius = ${rName})`,
      );
      return { script: next, target: profile };
    }
    case "polygonSketch": {
      const plane = str(values, "plane", "XY");
      const sidesName = nextBinding(script, "polygonSides");
      const radiusName = nextBinding(script, "polygonRadius");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      let next = upsertParams(script, {
        [sidesName]: Math.max(3, Math.round(num(values, "sides", 6))),
        [radiusName]: num(values, "radius", 20),
      });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(${plane})
${profile} = polygon(${sketch}, radius = ${radiusName}, numSides = ${sidesName}, center = [0, 0])`,
      );
      return { script: next, target: profile };
    }
    case "slotSketch": {
      const plane = str(values, "plane", "XY");
      const lengthName = nextBinding(script, "slotLength");
      const widthName = nextBinding(script, "slotWidth");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      let next = upsertParams(script, {
        [lengthName]: num(values, "length", 36),
        [widthName]: num(values, "width", 12),
      });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(${plane})
${profile} = startProfile(${sketch}, at = [-${lengthName} / 2, -${widthName} / 2])
  |> line(end = [${lengthName}, 0])
  |> tangentialArc(end = [0, ${widthName}])
  |> line(end = [-${lengthName}, 0])
  |> tangentialArc(end = [0, -${widthName}])
  |> close()`,
      );
      return { script: next, target: profile };
    }
    case "offsetPlane": {
      const plane = str(values, "plane", "XY");
      const offsetName = nextBinding(script, "planeOffset");
      const construction = nextBinding(script, "constructionPlane");
      const sketch = nextBinding(script, "sketch");
      let next = upsertParams(script, { [offsetName]: num(values, "offset", 20) });
      next = appendBlock(
        next,
        `${construction} = offsetPlane(${plane}, offset = ${offsetName})
${sketch} = startSketchOn(${construction})`,
      );
      return { script: next, target: sketch };
    }
    case "box": {
      const plane = str(values, "plane", "XY");
      const wName = nextBinding(script, "width");
      const dName = nextBinding(script, "depth");
      const hName = nextBinding(script, "height");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const body = nextBinding(script, "body");
      const w = num(values, "width", 40);
      const d = num(values, "depth", 40);
      const h = num(values, "height", 40);
      let next = upsertParams(script, { [wName]: w, [dName]: d, [hName]: h });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(${plane})
${profile} = startProfile(${sketch}, at = [-${wName} / 2, -${dName} / 2])
  |> line(end = [${wName}, 0], tag = $edge)
  |> line(end = [0, ${dName}])
  |> line(end = [-${wName}, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
${body} = extrude(${profile}, length = ${hName})`,
      );
      return { script: next, target: body };
    }
    case "cylinder": {
      const plane = str(values, "plane", "XY");
      const rName = nextBinding(script, "cylRadius");
      const hName = nextBinding(script, "cylHeight");
      const sketch = nextBinding(script, "sketch");
      const body = nextBinding(script, "body");
      const r = num(values, "radius", 15);
      const h = num(values, "height", 40);
      let next = upsertParams(script, { [rName]: r, [hName]: h });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(${plane})
${body} = circle(${sketch}, center = [0, 0], radius = ${rName})
  |> extrude(length = ${hName})`,
      );
      return { script: next, target: body };
    }
    case "sphere": {
      const radiusName = nextBinding(script, "sphereRadius");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const body = nextBinding(script, "body");
      let next = upsertParams(script, { [radiusName]: num(values, "radius", 20) });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(XZ)
${profile} = startProfile(${sketch}, at = [0, -${radiusName}])
  |> arc(endAbsolute = [0, ${radiusName}], interiorAbsolute = [${radiusName}, 0])
  |> close()
${body} = revolve(${profile}, axis = Y, angle = 360deg)`,
      );
      return { script: next, target: body };
    }
    case "prism": {
      const sidesName = nextBinding(script, "prismSides");
      const radiusName = nextBinding(script, "prismRadius");
      const heightName = nextBinding(script, "prismHeight");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const body = nextBinding(script, "body");
      let next = upsertParams(script, {
        [sidesName]: Math.max(3, Math.round(num(values, "sides", 6))),
        [radiusName]: num(values, "radius", 20),
        [heightName]: num(values, "height", 30),
      });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(XY)
${profile} = polygon(${sketch}, radius = ${radiusName}, numSides = ${sidesName}, center = [0, 0])
${body} = extrude(${profile}, length = ${heightName})`,
      );
      return { script: next, target: body };
    }
    case "cone": {
      const baseName = nextBinding(script, "coneBaseRadius");
      const topName = nextBinding(script, "coneTopRadius");
      const heightName = nextBinding(script, "coneHeight");
      const lowerSketch = nextBinding(script, "sketch");
      const lower = nextBinding(script, "profile");
      const upperSketch = nextBinding(script, "sketch");
      const upper = nextBinding(script, "profile");
      const body = nextBinding(script, "body");
      let next = upsertParams(script, {
        [baseName]: num(values, "baseRadius", 22),
        [topName]: num(values, "topRadius", 4),
        [heightName]: num(values, "height", 40),
      });
      next = appendBlock(
        next,
        `${lowerSketch} = startSketchOn(XY)
${lower} = circle(${lowerSketch}, center = [0, 0], radius = ${baseName})
${upperSketch} = startSketchOn(offsetPlane(XY, offset = ${heightName}))
${upper} = circle(${upperSketch}, center = [0, 0], radius = ${topName})
${body} = loft([${lower}, ${upper}])`,
      );
      return { script: next, target: body };
    }
    case "torus": {
      const majorName = nextBinding(script, "torusMajorRadius");
      const minorName = nextBinding(script, "torusTubeRadius");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const body = nextBinding(script, "body");
      let next = upsertParams(script, {
        [majorName]: num(values, "majorRadius", 24),
        [minorName]: num(values, "minorRadius", 6),
      });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(XZ)
${profile} = circle(${sketch}, center = [${majorName}, 0], radius = ${minorName})
${body} = revolve(${profile}, axis = Y, angle = 360deg)`,
      );
      return { script: next, target: body };
    }
    case "tube": {
      const outerName = nextBinding(script, "tubeOuterRadius");
      const wallName = nextBinding(script, "tubeWall");
      const heightName = nextBinding(script, "tubeHeight");
      const outerSketch = nextBinding(script, "sketch");
      const innerSketch = nextBinding(script, "sketch");
      const outerBody = nextBinding(script, "body");
      const innerBody = nextBinding(script, "body");
      const body = nextBinding(script, "body");
      const outer = num(values, "outerRadius", 18);
      const wall = Math.min(outer - 0.1, Math.max(0.1, num(values, "wall", 3)));
      let next = upsertParams(script, {
        [outerName]: outer,
        [wallName]: wall,
        [heightName]: num(values, "height", 40),
      });
      next = appendBlock(
        next,
        `${outerSketch} = startSketchOn(XY)
${outerBody} = circle(${outerSketch}, center = [0, 0], radius = ${outerName})
  |> extrude(length = ${heightName})
${innerSketch} = startSketchOn(XY)
${innerBody} = circle(${innerSketch}, center = [0, 0], radius = ${outerName} - ${wallName})
  |> extrude(length = ${heightName})
${body} = subtract(${outerBody}, tools = [${innerBody}])`,
      );
      return { script: next, target: body };
    }
    case "wedge": {
      const widthName = nextBinding(script, "wedgeWidth");
      const heightName = nextBinding(script, "wedgeHeight");
      const depthName = nextBinding(script, "wedgeDepth");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const body = nextBinding(script, "body");
      let next = upsertParams(script, {
        [widthName]: num(values, "width", 40),
        [heightName]: num(values, "height", 25),
        [depthName]: num(values, "depth", 30),
      });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(XZ)
${profile} = startProfile(${sketch}, at = [-${widthName} / 2, -${heightName} / 2])
  |> line(end = [${widthName}, 0])
  |> line(end = [-${widthName}, ${heightName}])
  |> close()
${body} = extrude(${profile}, length = ${depthName}, symmetric = true)`,
      );
      return { script: next, target: body };
    }
    case "ellipsoid": {
      const xName = nextBinding(script, "ellipsoidX");
      const yName = nextBinding(script, "ellipsoidY");
      const zName = nextBinding(script, "ellipsoidZ");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const body = nextBinding(script, "body");
      let next = upsertParams(script, {
        [xName]: num(values, "xRadius", 28),
        [yName]: num(values, "yRadius", 20),
        [zName]: num(values, "zRadius", 14),
      });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(XZ)
${profile} = startProfile(${sketch}, at = [0, -1])
  |> arc(endAbsolute = [0, 1], interiorAbsolute = [1, 0])
  |> close()
${body} = revolve(${profile}, axis = Y, angle = 360deg)
  |> scale(x = ${xName}, y = ${yName}, z = ${zName})`,
      );
      return { script: next, target: body };
    }
    case "capsule": {
      const lengthName = nextBinding(script, "capsuleLength");
      const widthName = nextBinding(script, "capsuleWidth");
      const heightName = nextBinding(script, "capsuleHeight");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const body = nextBinding(script, "body");
      let next = upsertParams(script, {
        [lengthName]: num(values, "length", 42),
        [widthName]: num(values, "width", 16),
        [heightName]: num(values, "height", 8),
      });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(XY)
${profile} = startProfile(${sketch}, at = [-${lengthName} / 2, -${widthName} / 2])
  |> line(end = [${lengthName}, 0])
  |> tangentialArc(end = [0, ${widthName}])
  |> line(end = [-${lengthName}, 0])
  |> tangentialArc(end = [0, -${widthName}])
  |> close()
${body} = extrude(${profile}, length = ${heightName})`,
      );
      return { script: next, target: body };
    }
    case "hexNut": {
      const outerName = nextBinding(script, "nutOuterRadius");
      const boreName = nextBinding(script, "nutBoreRadius");
      const heightName = nextBinding(script, "nutHeight");
      const outerSketch = nextBinding(script, "sketch");
      const outerBody = nextBinding(script, "body");
      const boreSketch = nextBinding(script, "sketch");
      const boreBody = nextBinding(script, "body");
      const body = nextBinding(script, "body");
      const outer = num(values, "outerRadius", 10);
      const bore = Math.min(outer - 0.1, Math.max(0.1, num(values, "boreRadius", 4)));
      let next = upsertParams(script, {
        [outerName]: outer,
        [boreName]: bore,
        [heightName]: num(values, "height", 6),
      });
      next = appendBlock(
        next,
        `${outerSketch} = startSketchOn(XY)
${outerBody} = polygon(${outerSketch}, radius = ${outerName}, numSides = 6, center = [0, 0])
  |> extrude(length = ${heightName})
${boreSketch} = startSketchOn(XY)
${boreBody} = circle(${boreSketch}, center = [0, 0], radius = ${boreName})
  |> extrude(length = ${heightName})
${body} = subtract(${outerBody}, tools = [${boreBody}])`,
      );
      return { script: next, target: body };
    }
    case "pushPull": {
      const face = str(values, "face", "top") as PushPullFace;
      const result = pushPullFace(script, face, num(values, "distance", 5));
      return { script: result.script, target: solid };
    }
    case "stretch": {
      const axis = str(values, "axis", "Z");
      const factor = Math.max(0.01, num(values, "factor", 1.15));
      const scaleName = nextBinding(script, `formScale${axis}`);
      let next = upsertParams(script, { [scaleName]: factor });
      next = pipeOntoSolid(
        next,
        solid!,
        `|> scale(x = ${axis === "X" ? scaleName : 1}, y = ${axis === "Y" ? scaleName : 1}, z = ${axis === "Z" ? scaleName : 1})`,
      );
      return { script: next, target: solid };
    }
    case "extrude": {
      const lenName = nextBinding(script, "extrudeLen");
      const length = num(values, "length", 20);
      const symmetric = bool(values, "symmetric", false);
      const sketch = findLastSketch(script);
      const body = nextBinding(script, "body");
      let next = upsertParams(script, { [lenName]: length });
      const sym = symmetric ? `, symmetric = true` : "";
      if (sketch) {
        next = appendBlock(next, `${body} = extrude(${sketch}, length = ${lenName}${sym})`);
      } else {
        // Fallback: box
        const plane = "XY";
        const wName = nextBinding(next, "width");
        const dName = nextBinding(next, "depth");
        const sk = nextBinding(next, "sketch");
        const profile = nextBinding(next, "profile");
        next = upsertParams(next, { [wName]: 40, [dName]: 40 });
        next = appendBlock(
          next,
          `${sk} = startSketchOn(${plane})
${profile} = startProfile(${sk}, at = [-${wName} / 2, -${dName} / 2])
  |> line(end = [${wName}, 0])
  |> line(end = [0, ${dName}])
  |> line(end = [-${wName}, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
${body} = extrude(${profile}, length = ${lenName}${sym})`,
        );
      }
      return { script: next, target: body };
    }
    case "revolve": {
      const plane = str(values, "plane", "XZ");
      const axis = str(values, "axis", "Y");
      const rName = nextBinding(script, "revOuter");
      const iName = nextBinding(script, "revInner");
      const hName = nextBinding(script, "revHeight");
      const aName = nextBinding(script, "revAngle");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const body = nextBinding(script, "body");
      const outer = num(values, "radius", 25);
      const inner = num(values, "inner", 10);
      const height = num(values, "height", 20);
      const angle = num(values, "angle", 360);
      let next = upsertParams(script, {
        [rName]: outer,
        [iName]: inner,
        [hName]: height,
        [aName]: angle,
      });
      const x0 = inner > 0 ? iName : "0";
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(${plane})
${profile} = startProfile(${sketch}, at = [${x0}, -${hName} / 2])
  |> line(end = [${rName} - ${x0}, 0])
  |> line(end = [0, ${hName}])
  |> line(end = [${x0} - ${rName}, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
${body} = revolve(${profile}, axis = ${axis}, angle = ${aName}deg)`,
      );
      return { script: next, target: body };
    }
    case "sweep": {
      const radiusName = nextBinding(script, "sweepRadius");
      const runName = nextBinding(script, "sweepRun");
      const bendName = nextBinding(script, "sweepBend");
      const riseName = nextBinding(script, "sweepRise");
      const profileSketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const pathSketch = nextBinding(script, "sketch");
      const path = nextBinding(script, "path");
      const body = nextBinding(script, "body");
      let next = upsertParams(script, {
        [radiusName]: num(values, "radius", 3),
        [runName]: num(values, "length", 40),
        [bendName]: num(values, "bend", 12),
        [riseName]: num(values, "rise", 18),
      });
      next = appendBlock(
        next,
        `${profileSketch} = startSketchOn(YZ)
${profile} = circle(${profileSketch}, center = [0, 0], radius = ${radiusName})
${pathSketch} = startSketchOn(XZ)
${path} = startProfile(${pathSketch}, at = [0, 0])
  |> xLine(length = ${runName})
  |> tangentialArc(end = [${bendName}, ${riseName}])
${body} = sweep(${profile}, path = ${path})`,
      );
      return { script: next, target: body };
    }
    case "loft": {
      const startName = nextBinding(script, "loftStartRadius");
      const endName = nextBinding(script, "loftEndRadius");
      const heightName = nextBinding(script, "loftHeight");
      const lowerSketch = nextBinding(script, "sketch");
      const lower = nextBinding(script, "profile");
      const upperSketch = nextBinding(script, "sketch");
      const upper = nextBinding(script, "profile");
      const body = nextBinding(script, "body");
      let next = upsertParams(script, {
        [startName]: num(values, "startRadius", 20),
        [endName]: num(values, "endRadius", 10),
        [heightName]: num(values, "height", 40),
      });
      next = appendBlock(
        next,
        `${lowerSketch} = startSketchOn(XY)
${lower} = circle(${lowerSketch}, center = [0, 0], radius = ${startName})
${upperSketch} = startSketchOn(offsetPlane(XY, offset = ${heightName}))
${upper} = circle(${upperSketch}, center = [0, 0], radius = ${endName})
${body} = loft([${lower}, ${upper}])`,
      );
      return { script: next, target: body };
    }
    case "twistExtrude": {
      const radiusName = nextBinding(script, "twistRadius");
      const sidesName = nextBinding(script, "twistSides");
      const heightName = nextBinding(script, "twistHeight");
      const angleName = nextBinding(script, "twistAngle");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const body = nextBinding(script, "body");
      let next = upsertParams(script, {
        [radiusName]: num(values, "radius", 18),
        [sidesName]: Math.max(3, Math.round(num(values, "sides", 6))),
        [heightName]: num(values, "height", 50),
        [angleName]: num(values, "angle", 120),
      });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(XY)
${profile} = polygon(${sketch}, radius = ${radiusName}, numSides = ${sidesName}, center = [0, 0])
${body} = extrude(${profile}, length = ${heightName}, twistAngle = ${angleName}deg, twistAngleStep = 12deg)`,
      );
      return { script: next, target: body };
    }
    case "draftExtrude": {
      const radiusName = nextBinding(script, "draftRadius");
      const heightName = nextBinding(script, "draftHeight");
      const angleName = nextBinding(script, "draftAngle");
      const sketch = nextBinding(script, "sketch");
      const profile = nextBinding(script, "profile");
      const body = nextBinding(script, "body");
      let next = upsertParams(script, {
        [radiusName]: num(values, "radius", 20),
        [heightName]: num(values, "height", 35),
        [angleName]: num(values, "angle", 8),
      });
      next = appendBlock(
        next,
        `${sketch} = startSketchOn(XY)
${profile} = circle(${sketch}, center = [0, 0], radius = ${radiusName})
${body} = extrude(${profile}, length = ${heightName}, draftAngle = ${angleName}deg)`,
      );
      return { script: next, target: body };
    }
    case "fillet": {
      const rName = nextBinding(script, "filletRadius");
      const r = num(values, "radius", 2);
      let next = upsertParams(script, { [rName]: r });
      next = pipeOntoSolid(
        next,
        solid!,
        `|> fillet(radius = ${rName}, tags = [getNextAdjacentEdge(END)])`,
      );
      return { script: next, target: solid };
    }
    case "chamfer": {
      const lName = nextBinding(script, "chamferLen");
      const length = num(values, "length", 2);
      let next = upsertParams(script, { [lName]: length });
      next = pipeOntoSolid(
        next,
        solid!,
        `|> chamfer(length = ${lName}, tags = [getNextAdjacentEdge(END)])`,
      );
      return { script: next, target: solid };
    }
    case "shell": {
      const tName = nextBinding(script, "shellThickness");
      const thickness = num(values, "thickness", 2);
      let next = upsertParams(script, { [tName]: thickness });
      next = pipeOntoSolid(next, solid!, `|> shell(faces = [END], thickness = ${tName})`);
      return { script: next, target: solid };
    }
    case "hole": {
      const dName = nextBinding(script, "holeDia");
      const depthName = nextBinding(script, "holeDepth");
      const holeSketch = nextBinding(script, "holeSketch");
      const dia = num(values, "diameter", 8);
      const depth = num(values, "depth", 50);
      let next = upsertParams(script, { [dName]: dia, [depthName]: depth });
      next = appendBlock(
        next,
        `${holeSketch} = startSketchOn(${solid}, face = END)
  |> circle(center = [0, 0], radius = ${dName} / 2)
  |> extrude(length = -${depthName})`,
      );
      return { script: next, target: solid };
    }
    case "appearance": {
      const color = str(values, "color", "#ff6b2c").trim();
      if (!/^#[0-9a-f]{6}$/i.test(color)) {
        throw new Error("Color must be a six-digit hex value such as #ff6b2c.");
      }
      const metalness = Math.min(100, Math.max(0, num(values, "metalness", 0)));
      const roughness = Math.min(100, Math.max(0, num(values, "roughness", 50)));
      const opacity = Math.min(100, Math.max(0, num(values, "opacity", 100)));
      const next = pipeOntoSolid(
        script,
        solid!,
        `|> appearance(color = "${color}", metalness = ${metalness}, roughness = ${roughness}, opacity = ${opacity})`,
      );
      return { script: next, target: solid };
    }
    case "mirror": {
      const plane = str(values, "plane", "YZ");
      const body = nextBinding(script, "body");
      const next = appendBlock(script, `${body} = mirror3d([${solid}], across = ${plane})`);
      return { script: next, target: body };
    }
    case "rotate": {
      const yaw = num(values, "yaw", 45);
      const pitch = num(values, "pitch", 0);
      const roll = num(values, "roll", 0);
      const yName = nextBinding(script, "yaw");
      const pName = nextBinding(script, "pitch");
      const rName = nextBinding(script, "roll");
      let next = upsertParams(script, { [yName]: yaw, [pName]: pitch, [rName]: roll });
      next = pipeOntoSolid(
        next,
        solid!,
        `|> rotate(yaw = ${yName}deg, pitch = ${pName}deg, roll = ${rName}deg)`,
      );
      return { script: next, target: solid };
    }
    case "translate": {
      const x = num(values, "x", 20);
      const y = num(values, "y", 0);
      const z = num(values, "z", 0);
      const xName = nextBinding(script, "moveX");
      const yName = nextBinding(script, "moveY");
      const zName = nextBinding(script, "moveZ");
      let next = upsertParams(script, { [xName]: x, [yName]: y, [zName]: z });
      next = pipeOntoSolid(next, solid!, `|> translate(x = ${xName}, y = ${yName}, z = ${zName})`);
      return { script: next, target: solid };
    }
    case "scale": {
      const x = num(values, "x", 1);
      const y = num(values, "y", 1);
      const z = num(values, "z", 1);
      const xName = nextBinding(script, "scaleX");
      const yName = nextBinding(script, "scaleY");
      const zName = nextBinding(script, "scaleZ");
      let next = upsertParams(script, { [xName]: x, [yName]: y, [zName]: z });
      next = pipeOntoSolid(next, solid!, `|> scale(x = ${xName}, y = ${yName}, z = ${zName})`);
      return { script: next, target: solid };
    }
    case "duplicate": {
      const xName = nextBinding(script, "copyX");
      const yName = nextBinding(script, "copyY");
      const zName = nextBinding(script, "copyZ");
      const body = nextBinding(script, "body");
      let next = upsertParams(script, {
        [xName]: num(values, "x", 30),
        [yName]: num(values, "y", 0),
        [zName]: num(values, "z", 0),
      });
      next = appendBlock(
        next,
        `${body} = clone(${solid})
  |> translate(x = ${xName}, y = ${yName}, z = ${zName})`,
      );
      return { script: next, target: body };
    }
    case "patternLinear": {
      const instances = Math.max(2, Math.round(num(values, "instances", 3)));
      const distance = num(values, "distance", 50);
      const axis = str(values, "axis", "X");
      const iName = nextBinding(script, "patternCount");
      const dName = nextBinding(script, "patternSpacing");
      let next = upsertParams(script, { [iName]: instances, [dName]: distance });
      next = pipeOntoSolid(
        next,
        solid!,
        `|> patternLinear3d(instances = ${iName}, distance = ${dName}, axis = ${axisVec(axis)})`,
      );
      return { script: next, target: solid };
    }
    case "patternCircular": {
      const instances = Math.max(2, Math.round(num(values, "instances", 4)));
      const arc = num(values, "arcDegrees", 360);
      const iName = nextBinding(script, "circCount");
      const aName = nextBinding(script, "circArc");
      let next = upsertParams(script, { [iName]: instances, [aName]: arc });
      next = pipeOntoSolid(
        next,
        solid!,
        `|> patternTransform(
       instances = ${iName},
       transform = fn(@i) {
         return {
           rotation = {
             angle = (${aName} / ${iName}) * i,
             axis = [0, 0, 1],
             origin = "global",
           },
         }
       },
     )`,
      );
      return { script: next, target: solid };
    }
    case "union":
    case "subtract":
    case "intersect": {
      if (solids.length < 2) {
        throw new Error(`${tool.label} needs at least two solids in the script.`);
      }
      const a = solids[solids.length - 2]!;
      const b = solids[solids.length - 1]!;
      const body = nextBinding(script, "body");
      let block: string;
      if (toolId === "union") block = `${body} = union([${a}, ${b}])`;
      else if (toolId === "intersect") block = `${body} = intersect([${a}, ${b}])`;
      else block = `${body} = subtract(${a}, tools = [${b}])`;
      return { script: appendBlock(script, block), target: body };
    }
    default:
      return { script, target: null };
  }
}
