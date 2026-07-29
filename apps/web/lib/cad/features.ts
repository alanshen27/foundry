import { parseCadParams } from "./params";

export type CadFeatureKind =
  "import" | "sketch" | "solid" | "modify" | "transform" | "pattern" | "boolean" | "unknown";

export type CadFeature = {
  id: string;
  binding: string;
  label: string;
  kind: CadFeatureKind;
  operation: string;
  lineStart: number;
  lineEnd: number;
  source: string;
  parameterNames: string[];
  isSolid: boolean;
};

export type CadFeatureField = {
  id: string;
  name: string;
  value: number;
  unit?: string;
  /** Offsets of the numeric literal within `CadFeature.source`. */
  start: number;
  end: number;
};

const OPERATION_LABELS: Array<{
  pattern: RegExp;
  operation: string;
  label: string;
  kind: CadFeatureKind;
  isSolid: boolean;
}> = [
  {
    pattern: /\bpatternLinear3d\s*\(/,
    operation: "patternLinear3d",
    label: "Linear pattern",
    kind: "pattern",
    isSolid: true,
  },
  {
    pattern: /\bpatternTransform\s*\(/,
    operation: "patternTransform",
    label: "Circular pattern",
    kind: "pattern",
    isSolid: true,
  },
  {
    pattern: /\bmirror3d\s*\(/,
    operation: "mirror3d",
    label: "Mirror",
    kind: "transform",
    isSolid: true,
  },
  {
    pattern: /\bclone\s*\(/,
    operation: "clone",
    label: "Duplicate",
    kind: "transform",
    isSolid: true,
  },
  {
    pattern: /\btranslate\s*\(/,
    operation: "translate",
    label: "Move",
    kind: "transform",
    isSolid: true,
  },
  {
    pattern: /\brotate\s*\(/,
    operation: "rotate",
    label: "Rotate",
    kind: "transform",
    isSolid: true,
  },
  {
    pattern: /\bscale\s*\(/,
    operation: "scale",
    label: "Scale",
    kind: "transform",
    isSolid: true,
  },
  {
    pattern: /\bfillet\s*\(/,
    operation: "fillet",
    label: "Fillet",
    kind: "modify",
    isSolid: true,
  },
  {
    pattern: /\bchamfer\s*\(/,
    operation: "chamfer",
    label: "Chamfer",
    kind: "modify",
    isSolid: true,
  },
  {
    pattern: /\bshell\s*\(/,
    operation: "shell",
    label: "Shell",
    kind: "modify",
    isSolid: true,
  },
  {
    pattern: /\bappearance\s*\(/,
    operation: "appearance",
    label: "Appearance",
    kind: "modify",
    isSolid: true,
  },
  {
    pattern: /\bsubtract\s*\(/,
    operation: "subtract",
    label: "Subtract",
    kind: "boolean",
    isSolid: true,
  },
  {
    pattern: /\bunion\s*\(/,
    operation: "union",
    label: "Union",
    kind: "boolean",
    isSolid: true,
  },
  {
    pattern: /\bintersect\s*\(/,
    operation: "intersect",
    label: "Intersect",
    kind: "boolean",
    isSolid: true,
  },
  {
    pattern: /\bextrude\s*\(/,
    operation: "extrude",
    label: "Extrude",
    kind: "solid",
    isSolid: true,
  },
  {
    pattern: /\bsweep\s*\(/,
    operation: "sweep",
    label: "Sweep",
    kind: "solid",
    isSolid: true,
  },
  {
    pattern: /\bloft\s*\(/,
    operation: "loft",
    label: "Loft",
    kind: "solid",
    isSolid: true,
  },
  {
    pattern: /\brevolve\s*\(/,
    operation: "revolve",
    label: "Revolve",
    kind: "solid",
    isSolid: true,
  },
  {
    pattern: /\bstartProfile\s*\(/,
    operation: "startProfile",
    label: "Profile",
    kind: "sketch",
    isSolid: false,
  },
  {
    pattern: /\bcircle\s*\(/,
    operation: "circle",
    label: "Circle",
    kind: "sketch",
    isSolid: false,
  },
  {
    pattern: /\bstartSketchOn\s*\(/,
    operation: "startSketchOn",
    label: "Sketch",
    kind: "sketch",
    isSolid: false,
  },
];

const TOP_LEVEL_ASSIGNMENT = /^([A-Za-z_]\w*)\s*=\s*(.*)$/;
const LITERAL_ASSIGNMENT = /^(-?\d+(?:\.\d+)?|true|false|"(?:[^"\\]|\\.)*")\s*(?:\/\/.*)?$/;
const IMPORT_ASSIGNMENT =
  /^\s*import\s+["']([^"']+\.(?:stl|step|stp|ste|obj|gltf|glb|ply|fbx|sat|sab|smb|smt|catpart|catproduct|prt|asm|g|neu|ipt|iam|x_t|x_b|sldprt))["']\s+as\s+([A-Za-z_]\w*)\s*$/i;

function describeFeature(source: string) {
  for (const candidate of OPERATION_LABELS) {
    if (candidate.pattern.test(source)) return candidate;
  }
  return {
    operation: "expression",
    label: "Feature",
    kind: "unknown" as const,
    isSolid: false,
  };
}

function referencedParameters(source: string, names: string[]): string[] {
  return names.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
}

/**
 * Derive a read-only feature history from executable KCL.
 *
 * KCL remains the source of truth. The history is intentionally derived rather
 * than persisted, so hand edits and AI edits always produce the same browser.
 */
export function parseCadFeatures(script: string): CadFeature[] {
  const lines = script.split("\n");
  const parameterNames = parseCadParams(script).map((param) => param.name);
  const features: CadFeature[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const imported = IMPORT_ASSIGNMENT.exec(line);
    if (imported) {
      const [, path, alias] = imported as unknown as [string, string, string];
      features.push({
        id: `import:${alias}:${index + 1}`,
        binding: alias,
        label: `Imported ${path.split("/").pop() ?? path}`,
        kind: "import",
        operation: "import",
        lineStart: index + 1,
        lineEnd: index + 1,
        source: line,
        parameterNames: [],
        isSolid: true,
      });
      continue;
    }

    if (/^\s/.test(line)) continue;
    const assignment = TOP_LEVEL_ASSIGNMENT.exec(line.trim());
    if (!assignment) continue;
    const [, binding, rhs] = assignment as unknown as [string, string, string];
    if (LITERAL_ASSIGNMENT.test(rhs)) continue;

    let end = index;
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const next = lines[cursor]!;
      const trimmed = next.trim();
      if (!trimmed || trimmed.startsWith("//")) break;
      if (!/^\s/.test(next) && (TOP_LEVEL_ASSIGNMENT.test(trimmed) || /^import\s+/.test(trimmed))) {
        break;
      }
      end = cursor;
    }

    const source = lines
      .slice(index, end + 1)
      .join("\n")
      .trimEnd();
    const descriptor = describeFeature(source);
    features.push({
      id: `${binding}:${index + 1}`,
      binding,
      label: `${descriptor.label} · ${binding}`,
      kind: descriptor.kind,
      operation: descriptor.operation,
      lineStart: index + 1,
      lineEnd: end + 1,
      source,
      parameterNames: referencedParameters(source, parameterNames),
      isSolid: descriptor.isSolid,
    });
    index = end;
  }

  return features;
}

const INLINE_FIELD_RE = /\b([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)(deg|mm|cm|m|in|ft|yd)?\b/g;

/** Named literal arguments such as `length = 20` or `angle = 90deg`. */
export function parseCadFeatureFields(feature: CadFeature): CadFeatureField[] {
  const fields: CadFeatureField[] = [];
  for (const match of feature.source.matchAll(INLINE_FIELD_RE)) {
    const name = match[1];
    const literal = match[2];
    if (!name || !literal || match.index === undefined) continue;
    const literalStart = match.index + match[0].indexOf(literal);
    fields.push({
      id: `${feature.id}:${name}:${literalStart}`,
      name,
      value: Number(literal),
      ...(match[3] ? { unit: match[3] } : {}),
      start: literalStart,
      end: literalStart + literal.length,
    });
  }
  return fields;
}

/** Replace one inline numeric argument without changing the rest of the KCL feature block. */
export function setCadFeatureField(
  script: string,
  feature: CadFeature,
  field: CadFeatureField,
  value: number,
): string {
  if (!Number.isFinite(value)) return script;
  const nextSource =
    feature.source.slice(0, field.start) + String(value) + feature.source.slice(field.end);
  const lines = script.split("\n");
  lines.splice(
    feature.lineStart - 1,
    feature.lineEnd - feature.lineStart + 1,
    ...nextSource.split("\n"),
  );
  return lines.join("\n");
}
