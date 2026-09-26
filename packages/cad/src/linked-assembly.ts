import {
  PRODUCT_ASSEMBLY_PATH,
  toZooKclPath,
  upsertCadContent,
  isCadStarterComponent,
} from "./doc";
import { PYTHON_ASSEMBLY_PATH, isPythonCadComponent, pythonModuleName } from "./python-project";
import type { CadAssemblyInstance, CadDoc } from "./port";

/** Stable, noncryptographic fingerprint for change detection, never access control. */
export function stableCadHash(value: unknown): string {
  const seen = new Set<object>();
  const canonical = (item: unknown): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item) ?? "null";
    if (seen.has(item)) throw new Error("Cannot fingerprint cyclic CAD data");
    seen.add(item);
    const result = Array.isArray(item)
      ? `[${item.map(canonical).join(",")}]`
      : `{${Object.keys(item)
          .sort()
          .filter((key) => (item as Record<string, unknown>)[key] !== undefined)
          .map(
            (key) => `${JSON.stringify(key)}:${canonical((item as Record<string, unknown>)[key])}`,
          )
          .join(",")}}`;
    seen.delete(item);
    return result;
  };
  const input = canonical(value);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    a = Math.imul(a ^ input.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ input.charCodeAt(i), 0x85ebca6b);
  }
  return `cad1-${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

function sourceHash(doc: CadDoc, instances: CadAssemblyInstance[]): string {
  return stableCadHash({
    version: 1,
    parts: doc.components
      .filter((c) => c.kind === "part")
      .map((c) => ({
        id: c.id,
        path: toZooKclPath(c.path),
        content: c.content,
        source: c.source,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    assets: [...(doc.assets ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    instances,
  });
}

export type LinkedAssemblyStatus = {
  linked: boolean;
  stale: boolean;
  modified: boolean;
  missingComponentIds: string[];
  unplacedComponentIds: string[];
};

export function linkedAssemblyStatus(doc: CadDoc): LinkedAssemblyStatus {
  const parts = doc.components.filter(
    (c) => c.kind === "part" && (doc.engine !== "build123d" || !isCadStarterComponent(c)),
  );
  const assembly = doc.assembly;
  const placed = new Set(assembly?.instances.map((i) => i.componentId) ?? []);
  const partIds = new Set(parts.map((p) => p.id));
  const component = doc.components.find(
    (c) =>
      c.kind === "assembly" &&
      c.path === (doc.engine === "build123d" ? PYTHON_ASSEMBLY_PATH : PRODUCT_ASSEMBLY_PATH),
  );
  return {
    linked: !!assembly,
    stale:
      !!assembly && (!component || assembly.sourceHash !== sourceHash(doc, assembly.instances)),
    modified:
      !!assembly && (!component || assembly.generatedHash !== stableCadHash(component.content)),
    missingComponentIds: [
      ...new Set(
        (assembly?.instances ?? [])
          .filter((i) => !partIds.has(i.componentId))
          .map((i) => i.componentId),
      ),
    ],
    unplacedComponentIds: parts.filter((p) => !placed.has(p.id)).map((p) => p.id),
  };
}

/**
 * Explicit build: imports authoritative parts and changes only assembly/product.kcl.
 * Existing placements persist; newly discovered parts start at the origin, UNVERIFIED.
 * Passing instances uses exactly that list, allowing hidden/omitted parts and duplicates.
 */
export function buildLinkedAssembly(doc: CadDoc, instances?: CadAssemblyInstance[]): CadDoc {
  const parts = doc.components.filter(
    (c) => c.kind === "part" && (doc.engine !== "build123d" || !isCadStarterComponent(c)),
  );
  if (!parts.length) throw new Error("Add a manufacturing part before building an assembly");
  const priorInstances =
    instances ??
    (doc.assembly?.instances ?? []).filter(
      (i) =>
        doc.engine !== "build123d" ||
        parts.some((p) => p.id === i.componentId && isPythonCadComponent(p)),
    );
  const nextInstances = priorInstances.map((i) => ({
    ...i,
    translationMm: { ...i.translationMm },
    rotationDeg: { ...i.rotationDeg },
  }));
  if (instances === undefined) {
    const placed = new Set(nextInstances.map((i) => i.componentId));
    for (const part of parts) {
      if (doc.engine === "build123d" && !isPythonCadComponent(part)) continue;
      if (!placed.has(part.id)) {
        let id = `instance-${part.id}`;
        while (nextInstances.some((i) => i.id === id)) id += "-new";
        nextInstances.push({
          id,
          componentId: part.id,
          translationMm: { x: 0, y: 0, z: 0 },
          rotationDeg: { x: 0, y: 0, z: 0 },
          visible: true,
          fixed: false,
        });
      }
    }
  }
  const ids = new Set<string>();
  for (const instance of nextInstances) {
    if (!instance.id || ids.has(instance.id))
      throw new Error("Assembly instance IDs must be unique and nonempty");
    ids.add(instance.id);
    if (
      doc.engine === "build123d" &&
      parts.some((p) => p.id === instance.componentId && !isPythonCadComponent(p))
    )
      throw new Error(
        "Convert or regenerate legacy KCL parts before adding native assembly instances",
      );
    if (!parts.some((p) => p.id === instance.componentId))
      throw new Error(`Assembly instance references a missing part: ${instance.componentId}`);
    if (
      ![...Object.values(instance.translationMm), ...Object.values(instance.rotationDeg)].every(
        Number.isFinite,
      )
    )
      throw new Error("Assembly poses must contain finite millimetres and degrees");
  }
  if (doc.engine === "build123d" && !nextInstances.length)
    throw new Error(
      "Add a native Python manufacturing part before building an assembly; legacy KCL must be converted first",
    );
  const visible = nextInstances.filter((i) => i.visible);
  if (doc.engine === "build123d") {
    const lines = [
      "# LOCAL linked manufacturing assembly — millimetres, Z up.",
      "# UNVERIFIED placement: explicit poses only; no solved mates or collision approval.",
      "# Global rotations X, Y, Z, then translation. Source parts remain unchanged.",
      "from copy import deepcopy",
      "from build123d import Axis, Builder, Compound",
      "",
    ];
    const aliases = new Map<string, string>();
    for (const instance of visible) {
      if (aliases.has(instance.componentId)) continue;
      const part = parts.find((p) => p.id === instance.componentId)!;
      if (!isPythonCadComponent(part))
        throw new Error(
          `Convert or regenerate legacy KCL part '${part.name}' to Python before building a native assembly`,
        );
      const alias = `source${aliases.size + 1}`;
      aliases.set(instance.componentId, alias);
      lines.push(
        `from ${pythonModuleName(part.path)} import result as ${alias}`,
        `if isinstance(${alias}, Builder):`,
        `    ${alias} = ${alias}.part`,
      );
    }
    lines.push("", "children = []");
    for (const [index, instance] of visible.entries()) {
      const part = parts.find((p) => p.id === instance.componentId)!;
      const name = `instance${index + 1}`;
      lines.push(`\n${name} = deepcopy(${aliases.get(part.id)})`);
      for (const [axis, angle] of [
        ["X", instance.rotationDeg.x],
        ["Y", instance.rotationDeg.y],
        ["Z", instance.rotationDeg.z],
      ] as const) {
        if (angle) lines.push(`${name} = ${name}.rotate(Axis.${axis}, ${angle})`);
      }
      const t = instance.translationMm;
      lines.push(
        `${name} = ${name}.translate((${t.x}, ${t.y}, ${t.z}))`,
        `${name}.label = ${JSON.stringify(`${part.name} (${instance.id})`)}`,
        `children.append(${name})`,
      );
    }
    lines.push("", "result = Compound(children=children)", "");
    const content = lines.join("\n");
    return {
      ...upsertCadContent(doc, PYTHON_ASSEMBLY_PATH, content),
      assembly: {
        version: 1,
        instances: nextInstances,
        sourceHash: sourceHash(doc, nextInstances),
        generatedHash: stableCadHash(content),
      },
    };
  }
  const lines = [
    "// LOCAL linked manufacturing assembly — millimetres, Z up.",
    "// UNVERIFIED placement: explicit poses only; no solved mates or collision approval.",
    "// Rotate about global origin: X, then Y, then Z; translate in global millimetres.",
    "// Edit source parts in parts/; rebuild explicitly after source or pose changes.",
    "",
  ];
  const baseAliases = new Map<string, string>();
  for (const instance of visible) {
    if (baseAliases.has(instance.componentId)) continue;
    const part = parts.find((p) => p.id === instance.componentId)!;
    const path = toZooKclPath(part.path);
    if (path.split("/").some((s) => s === "..") || /[\r\n\x00]/.test(path))
      throw new Error(`Invalid assembly part path: ${path}`);
    const alias = `source${baseAliases.size + 1}`;
    baseAliases.set(instance.componentId, alias);
    lines.push(`import ${JSON.stringify(path)} as ${alias}`);
  }
  lines.push("");
  // Clone repeated bodies before moving any original. Otherwise duplicates inherit
  // the first instance's transform instead of their manufacturing coordinate system.
  const seenSources = new Set<string>();
  visible.forEach((instance, index) => {
    const source = baseAliases.get(instance.componentId)!;
    const expression = seenSources.has(instance.componentId) ? `clone(${source})` : source;
    lines.push(`instance${index + 1} = ${expression}`);
    seenSources.add(instance.componentId);
  });
  visible.forEach((instance, index) => {
    const part = parts.find((p) => p.id === instance.componentId)!;
    const label = `${part.name} (${instance.id})`.replace(/[\r\n]/g, " ");
    lines.push(
      "",
      `// ${label} — UNVERIFIED${instance.fixed ? "; placement locked" : ""}`,
      `placed${index + 1} = instance${index + 1}`,
    );
    const { x, y, z } = instance.rotationDeg;
    for (const [axis, angle] of [
      ["[1, 0, 0]", x],
      ["[0, 1, 0]", y],
      ["[0, 0, 1]", z],
    ] as const) {
      if (angle !== 0)
        lines.push(`  |> rotate(axis = ${axis}, angle = ${angle}deg, global = true)`);
    }
    const translation = instance.translationMm;
    lines.push(
      `  |> translate(x = ${translation.x}mm, y = ${translation.y}mm, z = ${translation.z}mm, global = true)`,
    );
  });
  if (!visible.length)
    lines.push("// All assembly instances are hidden; there is no visible geometry.");
  const content = lines.join("\n") + "\n";
  const next = upsertCadContent(doc, PRODUCT_ASSEMBLY_PATH, content);
  return {
    ...next,
    assembly: {
      version: 1,
      instances: nextInstances,
      sourceHash: sourceHash(doc, nextInstances),
      generatedHash: stableCadHash(content),
    },
  };
}
