import type { CadAsset, CadAssetFormat, CadComponent, CadComponentKind, CadDoc } from "./port";

export type { CadAsset, CadAssetFormat };

/**
 * Default parametric KCL part. Top-level numeric bindings are exposed as
 * visual controls in the model editor (see parseCadParams).
 */
export const DEFAULT_KCL = `// Zoo KCL — millimetres. Top-level numbers become visual parameters.
width = 60
depth = 30
height = 20

sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-width / 2, -depth / 2])
  |> line(end = [width, 0])
  |> line(end = [0, depth])
  |> line(end = [-width, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
body = extrude(profile001, length = height)
`;

/** Marker comment — insertPartIntoAssembly replaces the stock envelope when present. */
export const ASSEMBLY_ENVELOPE_MARKER = "assemblyEnvelope = extrude";

/**
 * Canonical product assembly path. Engineer > Assembly and Zoo assemble always
 * target this file — never assembly/<other>.kcl.
 */
export const PRODUCT_ASSEMBLY_PATH = "assembly/product.kcl";

export const DEFAULT_ASSEMBLY_KCL = `// Product assembly (mm) — import parts as …/main.kcl (Zoo subdirectory rule).
// Drag a part onto Assembly in the tree to place it here.
// Example:
//   import "parts/main.kcl" as main
//   main
//   import "parts/lid/main.kcl" as lid
//   lid |> translate(z = 25)

assyWidth = 120
assyDepth = 80
assyHeight = 40

baseSketch = startSketchOn(XY)
baseProfile = startProfile(baseSketch, at = [-assyWidth / 2, -assyDepth / 2])
  |> line(end = [assyWidth, 0])
  |> line(end = [0, assyDepth])
  |> line(end = [-assyWidth, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
assemblyEnvelope = extrude(baseProfile, length = assyHeight)
`;

export const ASSEMBLY_STARTER_KCL = `// Product PREVIEW (mm) — visual assembly for Engineer > Assembly.
// Manufacturing geometry lives under parts/; regenerate this file with add_part_to_assembly.

`;

/** Tiny stand-in when a part is mesh-only (browser can't resolve STL inside modules). */
export function meshPartProxyKcl(name: string): string {
  const label = name.replace(/"/g, "");
  return `// UNVERIFIED mesh proxy for "${label}" — real STL/STEP loads when the part is open alone.
proxyW = 12
proxyD = 12
proxyH = 4
proxySketch = startSketchOn(XY)
proxyProfile = startProfile(proxySketch, at = [-proxyW / 2, -proxyD / 2])
  |> line(end = [proxyW, 0])
  |> line(end = [0, proxyD])
  |> line(end = [-proxyW, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
proxyBody = extrude(proxyProfile, length = proxyH)
proxyBody
`;
}

export const DEFAULT_INSTRUCTIONS_MD = `# Assembly instructions

1. Print or machine each part under **parts/**.
2. Dry-fit the **assembly** envelope and check clearances.
3. Fasten mounts, then route cables / PCB last.
4. Update this checklist as the design changes.

> UNVERIFIED — human-editable guide generated with the CAD workspace.
`;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cad_${Math.random().toString(36).slice(2, 12)}`;
}

/** Sanitize a display name into a path segment. */
export function slugifyCadName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "part";
}

function pathFor(kind: CadComponentKind, name: string): string {
  const slug = slugifyCadName(name);
  // Zoo: subdirectory imports must target main.kcl. Store parts that way so
  // assembly/product.kcl can import them without a rewrite pass failing execute.
  if (kind === "part") {
    if (slug === "main") return "parts/main.kcl";
    return `parts/${slug}/main.kcl`;
  }
  // One product assembly only — ignore the requested name for pathing.
  if (kind === "assembly") return PRODUCT_ASSEMBLY_PATH;
  return `docs/${slug}.md`;
}

/** Folder (or file stem) used as the human/part name for a CadDoc path. */
export function displayNameFromCadPath(path: string): string {
  const segs = path.split("/").filter(Boolean);
  const file = segs[segs.length - 1] ?? path;
  // Zoo stores named parts as parts/<slug>/main.kcl — use the folder, not "main".
  // parts/main.kcl is the root part (only two segments); keep stem "main".
  if (file.toLowerCase() === "main.kcl" && segs.length >= 3) {
    return segs[segs.length - 2]!;
  }
  return file.replace(/\.(kcl|md)$/i, "") || "part";
}

function mirrorScript(components: CadComponent[], activeId: string): string {
  const active = components.find((c) => c.id === activeId);
  if (active && (active.kind === "part" || active.kind === "assembly") && active.content.trim()) {
    return active.content;
  }
  const fallback = components.find(
    (c) => (c.kind === "part" || c.kind === "assembly") && c.content.trim(),
  );
  return fallback?.content ?? DEFAULT_KCL;
}

function withMirror(doc: Omit<CadDoc, "script">): CadDoc {
  const next: CadDoc = {
    ...doc,
    script: mirrorScript(doc.components, doc.activeId),
  };
  if (doc.assets?.length) next.assets = doc.assets;
  else delete next.assets;
  return next;
}

const ASSET_FORMATS = new Set<CadAssetFormat>([
  "kcl",
  "stl",
  "step",
  "stp",
  "ste",
  "obj",
  "gltf",
  "glb",
  "ply",
  "fbx",
  "sat",
  "sab",
  "smb",
  "smt",
  "catpart",
  "catproduct",
  "prt",
  "asm",
  "g",
  "neu",
  "ipt",
  "iam",
  "x_t",
  "x_b",
  "sldprt",
  "sldasm",
  "f3d",
  "cam360",
  "ige",
  "iges",
  "igs",
  "3mf",
  "3dm",
  "skp",
  "dwg",
  "dxf",
  "svg",
  "jt",
  "tsm",
  "wire",
  "123dx",
  "sch",
  "brd",
  "kicad_sch",
  "kicad_pcb",
  "kicad_pro",
  "kicad_prl",
]);

const ENGINE_IMPORT_FORMATS = new Set<CadAssetFormat>([
  "stl",
  "step",
  "stp",
  "ste",
  "obj",
  "gltf",
  "glb",
  "ply",
  "fbx",
  "sat",
  "sab",
  "smb",
  "smt",
  "catpart",
  "catproduct",
  "prt",
  "asm",
  "g",
  "neu",
  "ipt",
  "iam",
  "x_t",
  "x_b",
  "sldprt",
]);

const ELECTRONICS_FORMATS = new Set<CadAssetFormat>([
  "sch",
  "brd",
  "kicad_sch",
  "kicad_pcb",
  "kicad_pro",
  "kicad_prl",
]);

export type CadAssetImportMode = "native-kcl" | "engine" | "reference" | "electronics";

export function cadAssetImportMode(format: CadAssetFormat): CadAssetImportMode {
  if (format === "kcl") return "native-kcl";
  if (ENGINE_IMPORT_FORMATS.has(format)) return "engine";
  if (ELECTRONICS_FORMATS.has(format)) return "electronics";
  return "reference";
}

export function isEngineCadAssetFormat(format: CadAssetFormat): boolean {
  return ENGINE_IMPORT_FORMATS.has(format);
}

export function cadAssetFormatFromName(filename: string): CadAssetFormat | null {
  const ext = filename.trim().toLowerCase().split(".").pop();
  if (!ext || !ASSET_FORMATS.has(ext as CadAssetFormat)) return null;
  return ext as CadAssetFormat;
}

/** Sanitize a mesh filename into `imports/{slug}.{ext}`. */
export function importAssetPath(filename: string, format: CadAssetFormat): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const slug = slugifyCadName(base || "import");
  const ext = format === "stp" || format === "ste" ? "step" : format;
  return `imports/${slug}.${ext}`;
}

/**
 * KCL foreign-import stub for a mesh/B-Rep file.
 * Not parametric — labeled UNVERIFIED per product rules.
 */
export function kclForForeignImport(
  asset: Pick<CadAsset, "path" | "name" | "format" | "lengthUnit">,
): string {
  const file = asset.path.split("/").pop() ?? asset.path;
  const alias =
    slugifyCadName(asset.name || file.replace(/\.[^.]+$/, "")).replace(/-/g, "_") || "mesh";
  const mode = cadAssetImportMode(asset.format);
  if (mode !== "engine") {
    const title =
      mode === "electronics"
        ? `${asset.format.toUpperCase()} electronics reference`
        : `${asset.format.toUpperCase()} source reference`;
    const color = mode === "electronics" ? "#23b26d" : "#718096";
    return `// UNVERIFIED — ${title} preserved at "${asset.path}".
// The original file stays downloadable. This movable proxy intentionally does
// not claim to decode proprietary feature history or electronics topology.
sourceWidth = 40
sourceDepth = 28
sourceHeight = 8
sourceSketch = startSketchOn(XY)
sourceProfile = startProfile(sourceSketch, at = [-sourceWidth / 2, -sourceDepth / 2])
  |> line(end = [sourceWidth, 0])
  |> line(end = [0, sourceDepth])
  |> line(end = [-sourceWidth, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sourceProxy = extrude(sourceProfile, length = sourceHeight)
  |> appearance(color = "${color}", metalness = 10, roughness = 65)
`;
  }
  const needsUnit = asset.format === "stl" || asset.format === "obj" || asset.format === "ply";
  const unit = asset.lengthUnit ?? "mm";
  const attr = needsUnit ? `@(lengthUnit = ${unit})\n` : "";
  return `// UNVERIFIED — foreign mesh import (not parametric KCL).
// Zoo Design Studio can resolve this path; the Foundry viewport loads the mesh via import_files.
${attr}import "${asset.path}" as ${alias}
${alias}
`;
}

/** Parse `import "path.ext" as alias` from a KCL script. */
export function parseForeignImports(kcl: string): { path: string; alias: string }[] {
  const out: { path: string; alias: string }[] = [];
  const re =
    /^\s*import\s+["']([^"']+\.(?:stl|step|stp|ste|obj|gltf|glb|ply|fbx|sat|sab|smb|smt|catpart|catproduct|prt|asm|g|neu|ipt|iam|x_t|x_b|sldprt))["']\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(kcl)) !== null) {
    out.push({ path: m[1]!, alias: m[2]! });
  }
  return out;
}

/** True when the script is only comments / blank / foreign imports (+ optional alias refs). */
export function isForeignImportOnlyScript(kcl: string): boolean {
  const imports = parseForeignImports(kcl);
  if (imports.length === 0) return false;
  const aliases = new Set(imports.map((i) => i.alias));
  for (const line of kcl.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("//")) continue;
    if (/^@\(/.test(t)) continue;
    if (/^import\s+["']/i.test(t)) continue;
    if (aliases.has(t)) continue;
    return false;
  }
  return true;
}

/**
 * Zoo KCL: imports from a subdirectory may only target `main.kcl`
 * (https://zoo.dev/docs/kcl-lang/modules). Logical Foundry paths like
 * `parts/lid.kcl` therefore become `parts/lid/main.kcl` at execute time.
 * Same-directory / already-`main.kcl` paths are unchanged.
 */
export function toZooKclPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.toLowerCase().endsWith(".kcl")) return trimmed;
  const segs = trimmed.split("/");
  const file = segs[segs.length - 1]!;
  if (file.toLowerCase() === "main.kcl") return trimmed;
  if (segs.length === 1) return trimmed;
  const stem = file.replace(/\.kcl$/i, "");
  return [...segs.slice(0, -1), stem, "main.kcl"].join("/");
}

/** Inverse of {@link toZooKclPath} for matching CadDoc component paths. */
export function fromZooKclPath(path: string): string {
  const trimmed = path.trim();
  const m = /^(.+)\/([^/]+)\/main\.kcl$/i.exec(trimmed);
  if (!m) return trimmed;
  return `${m[1]}/${m[2]}.kcl`;
}

/** Rewrite `.kcl` module import paths on import lines (leaves STL/STEP alone). */
export function rewriteKclModuleImportPaths(
  kcl: string,
  mapPath: (path: string) => string = toZooKclPath,
): string {
  return kcl
    .split("\n")
    .map((line) => {
      if (!/^\s*(export\s+)?import\s+/i.test(line)) return line;
      return line.replace(
        /(["'])([^"']+\.kcl)\1/g,
        (_m, q: string, p: string) => `${q}${mapPath(p)}${q}`,
      );
    })
    .join("\n");
}

function modulePathsEqual(a: string, b: string): boolean {
  return a === b || toZooKclPath(a) === toZooKclPath(b) || fromZooKclPath(a) === fromZooKclPath(b);
}

/** KCL module import: `import "parts/foo.kcl" as foo` (and bare import). */
export function parseKclModuleImports(kcl: string): { path: string; alias: string }[] {
  const out: { path: string; alias: string }[] = [];
  const withAs = /^\s*import\s+["']([^"']+\.kcl)["']\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = withAs.exec(kcl)) !== null) {
    out.push({ path: m[1]!, alias: m[2]! });
  }
  const bare = /^\s*import\s+["']([^"']+\.kcl)["']\s*$/gim;
  while ((m = bare.exec(kcl)) !== null) {
    const path = m[1]!;
    if (out.some((i) => i.path === path)) continue;
    const file = path.split("/").pop() ?? path;
    const alias = slugifyCadName(file.replace(/\.kcl$/, "")).replace(/-/g, "_") || "part";
    out.push({ path, alias });
  }
  return out;
}

export function partModuleAlias(part: Pick<CadComponent, "name" | "path">): string {
  const fromName = slugifyCadName(part.name).replace(/-/g, "_");
  if (fromName && /^[A-Za-z_]/.test(fromName)) return fromName;
  const file = (part.path.split("/").pop() ?? "part").replace(/\.kcl$/, "");
  const fromPath = slugifyCadName(file).replace(/-/g, "_");
  return /^[A-Za-z_]/.test(fromPath) ? fromPath : `part_${fromPath}`;
}

function isStockAssemblyEnvelope(kcl: string): boolean {
  return kcl.includes(ASSEMBLY_ENVELOPE_MARKER);
}

function ensureModuleImport(kcl: string, path: string, alias: string): string {
  const importPath = toZooKclPath(path);
  const existing = parseKclModuleImports(kcl);
  if (existing.some((i) => modulePathsEqual(i.path, path) || i.alias === alias)) return kcl;

  const lines = kcl.split("\n");
  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t || t.startsWith("//") || t.startsWith("@(")) {
      insertAt = i + 1;
      continue;
    }
    if (/^import\s+/i.test(t)) {
      insertAt = i + 1;
      continue;
    }
    break;
  }
  const next = [...lines];
  next.splice(insertAt, 0, `import "${importPath}" as ${alias}`);
  return next.join("\n");
}

/**
 * Add a part into an assembly via KCL whole-module import.
 * Replaces the stock envelope the first time a part is inserted.
 */
export function insertPartIntoAssembly(doc: CadDoc, assemblyId: string, partId: string): CadDoc {
  const assembly = doc.components.find((c) => c.id === assemblyId);
  const part = doc.components.find((c) => c.id === partId);
  if (!assembly || assembly.kind !== "assembly" || !part || part.kind !== "part") {
    return doc;
  }

  const alias = partModuleAlias(part);
  const already = parseKclModuleImports(assembly.content).find((i) =>
    modulePathsEqual(i.path, part.path),
  );
  let content = assembly.content;

  if (isStockAssemblyEnvelope(content)) {
    content = ASSEMBLY_STARTER_KCL;
  }

  if (already) {
    content = `${content.trimEnd()}\nclone(${already.alias})\n  |> translate(x = 20)\n`;
  } else {
    content = ensureModuleImport(content, part.path, alias);
    content = `${content.trimEnd()}\n${alias}\n`;
  }

  return setActiveComponent(updateComponentContent(doc, assemblyId, content), assemblyId);
}

export type KclProjectBuild = {
  /** path → KCL source for Zoo multi-file submit */
  files: Record<string, string>;
  entryPath: string;
  /** Mesh assets referenced by (original) part scripts */
  meshAssets: CadAsset[];
};

/**
 * Build a multi-file KCL project for the Zoo executor.
 * Remaps `parts/foo.kcl` → `parts/foo/main.kcl` so subdirectory imports satisfy
 * Zoo's main.kcl-only rule. Mesh-only parts imported by the entry become small
 * proxy solids (browser KCL can't resolve STL inside modules).
 */
export function buildKclProject(doc: CadDoc, entryPath: string): KclProjectBuild {
  const files: Record<string, string> = {};
  const meshAssets: CadAsset[] = [];
  const assetsByPath = new Map((doc.assets ?? []).map((a) => [a.path, a]));
  const entry = doc.components.find((c) => c.path === entryPath);
  const zooEntry = toZooKclPath(entryPath);
  const importedLogical = new Set(
    parseKclModuleImports(entry?.content ?? "").map((i) => fromZooKclPath(i.path)),
  );

  for (const c of doc.components) {
    if (c.kind === "instructions") continue;
    const foreign = parseForeignImports(c.content);
    for (const f of foreign) {
      const asset = assetsByPath.get(f.path);
      if (asset && !meshAssets.some((a) => a.id === asset.id)) meshAssets.push(asset);
    }

    let content = c.content;
    if (c.kind === "part" && importedLogical.has(c.path) && foreign.length > 0) {
      content = meshPartProxyKcl(c.name);
    } else {
      content = rewriteKclModuleImportPaths(content);
    }
    // Empty modules deserialize as null Program and crash Zoo multi-file submit.
    if (!content.trim() && c.path !== entryPath) continue;
    files[toZooKclPath(c.path)] = content;
  }

  if (!files[zooEntry]) {
    files[zooEntry] = rewriteKclModuleImportPaths(entry?.content ?? DEFAULT_KCL);
  }

  return { files, entryPath: zooEntry, meshAssets };
}

export function addCadAsset(doc: CadDoc, asset: Omit<CadAsset, "id"> & { id?: string }): CadDoc {
  const id = asset.id ?? newId();
  const assets = [...(doc.assets ?? [])];
  const existingIdx = assets.findIndex((a) => a.path === asset.path);
  const nextAsset: CadAsset = {
    id,
    name: asset.name,
    path: asset.path,
    format: asset.format,
    storageKey: asset.storageKey,
    sizeBytes: asset.sizeBytes,
    lengthUnit: asset.lengthUnit,
  };
  if (existingIdx >= 0) assets[existingIdx] = { ...nextAsset, id: assets[existingIdx]!.id };
  else assets.push(nextAsset);
  return withMirror({ ...doc, assets });
}

/** Store asset + create/activate a part that imports it. */
export function importMeshAsPart(
  doc: CadDoc,
  assetInput: Omit<CadAsset, "id"> & { id?: string },
): CadDoc {
  const withAsset = addCadAsset(doc, assetInput);
  const asset = (withAsset.assets ?? []).find((a) => a.path === assetInput.path)!;
  const partName = slugifyCadName(asset.name) || "imported";
  return upsertPartScript(withAsset, partName, kclForForeignImport(asset));
}

function normalizeAsset(raw: unknown): CadAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (
    typeof a.id !== "string" ||
    typeof a.name !== "string" ||
    typeof a.path !== "string" ||
    typeof a.storageKey !== "string" ||
    typeof a.sizeBytes !== "number"
  ) {
    return null;
  }
  if (typeof a.format !== "string" || !ASSET_FORMATS.has(a.format as CadAssetFormat)) return null;
  const lengthUnit =
    a.lengthUnit === "mm" ||
    a.lengthUnit === "cm" ||
    a.lengthUnit === "m" ||
    a.lengthUnit === "in" ||
    a.lengthUnit === "ft" ||
    a.lengthUnit === "yd"
      ? a.lengthUnit
      : undefined;
  return {
    id: a.id,
    name: a.name,
    path: a.path,
    format: a.format as CadAssetFormat,
    storageKey: a.storageKey,
    sizeBytes: a.sizeBytes,
    lengthUnit,
  };
}

/** Build a full CAD workspace from a single KCL part script (compat). */
export function cadDoc(script: string): CadDoc {
  const partId = newId();
  const assemblyId = newId();
  const instructionsId = newId();
  const content = script.trim() ? script : DEFAULT_KCL;
  return withMirror({
    version: 5,
    engine: "zoo",
    activeId: partId,
    components: [
      {
        id: partId,
        name: "main",
        path: "parts/main.kcl",
        kind: "part",
        content,
      },
      {
        id: assemblyId,
        name: "product",
        path: "assembly/product.kcl",
        kind: "assembly",
        content: DEFAULT_ASSEMBLY_KCL,
      },
      {
        id: instructionsId,
        name: "assembly-instructions",
        path: "docs/assembly-instructions.md",
        kind: "instructions",
        content: DEFAULT_INSTRUCTIONS_MD,
      },
    ],
  });
}

export function getActiveComponent(doc: CadDoc): CadComponent {
  return doc.components.find((c) => c.id === doc.activeId) ?? doc.components[0]!;
}

export function listComponentsByKind(doc: CadDoc, kind: CadComponentKind): CadComponent[] {
  return doc.components.filter((c) => c.kind === kind);
}

export function setActiveComponent(doc: CadDoc, activeId: string): CadDoc {
  if (!doc.components.some((c) => c.id === activeId)) return doc;
  return withMirror({ ...doc, activeId });
}

/**
 * Canvas drops target the open assembly, or fall back to the product assembly
 * when the user is currently viewing an individual part.
 */
export function assemblyDropTargetId(doc: CadDoc, activeId = doc.activeId): string | null {
  const active = doc.components.find((component) => component.id === activeId);
  if (active?.kind === "assembly") return active.id;
  return doc.components.find((component) => component.kind === "assembly")?.id ?? null;
}

export function updateComponentContent(doc: CadDoc, id: string, content: string): CadDoc {
  const components = doc.components.map((c) => (c.id === id ? { ...c, content } : c));
  return withMirror({ ...doc, components });
}

/** Drop components by id; reassigns activeId when the active one is removed. */
export function removeCadComponents(doc: CadDoc, ids: Iterable<string>): CadDoc {
  const drop = new Set(ids);
  if (drop.size === 0) return doc;
  const components = doc.components.filter((c) => !drop.has(c.id));
  if (components.length === doc.components.length) return doc;
  const activeId = drop.has(doc.activeId) ? (components[0]?.id ?? doc.activeId) : doc.activeId;
  return withMirror({ ...doc, components, activeId });
}

export function addCadComponent(
  doc: CadDoc,
  input: { name: string; kind: CadComponentKind; content?: string },
): CadDoc {
  return addCadComponents(doc, [input]);
}

/** Add many components in one pass (avoids parallel tool last-write-wins). */
export function addCadComponents(
  doc: CadDoc,
  inputs: { name: string; kind: CadComponentKind; content?: string }[],
): CadDoc {
  if (inputs.length === 0) return doc;
  let components = [...doc.components];
  let activeId = doc.activeId;
  const used = new Set(components.map((c) => c.path));

  for (const input of inputs) {
    // Product assembly is singular — update assembly/product.kcl in place.
    if (input.kind === "assembly") {
      const existing =
        components.find((c) => c.path === PRODUCT_ASSEMBLY_PATH) ??
        components.find((c) => c.kind === "assembly");
      const content = input.content?.trim() || existing?.content || DEFAULT_ASSEMBLY_KCL;
      if (existing) {
        components = components.map((c) =>
          c.id === existing.id
            ? {
                ...c,
                name: "product",
                path: PRODUCT_ASSEMBLY_PATH,
                kind: "assembly" as const,
                content,
              }
            : c,
        );
        activeId = existing.id;
        used.add(PRODUCT_ASSEMBLY_PATH);
        continue;
      }
      const id = newId();
      components = [
        ...components,
        {
          id,
          name: "product",
          path: PRODUCT_ASSEMBLY_PATH,
          kind: "assembly",
          content,
        },
      ];
      used.add(PRODUCT_ASSEMBLY_PATH);
      activeId = id;
      continue;
    }

    const id = newId();
    let path = pathFor(input.kind, input.name);
    if (used.has(path)) {
      const base = path.replace(/\.(kcl|md)$/, "");
      const ext = input.kind === "instructions" ? "md" : "kcl";
      let i = 2;
      while (used.has(`${base}-${i}.${ext}`)) i += 1;
      path = `${base}-${i}.${ext}`;
    }
    used.add(path);
    const content =
      input.content?.trim() || (input.kind === "part" ? DEFAULT_KCL : DEFAULT_INSTRUCTIONS_MD);
    components = [
      ...components,
      {
        id,
        name: input.name.trim() || slugifyCadName(path),
        path,
        kind: input.kind,
        content,
      },
    ];
    activeId = id;
  }

  return withMirror({ ...doc, activeId, components });
}

function matchComponent(
  doc: CadDoc,
  pathOrName: string,
  kind?: CadComponentKind,
): CadComponent | undefined {
  const key = pathOrName.trim();
  const zooKey = toZooKclPath(key);
  return doc.components.find((c) => {
    if (kind && c.kind !== kind) return false;
    return (
      c.path === key ||
      c.path === zooKey ||
      c.name === key ||
      toZooKclPath(c.path) === zooKey ||
      fromZooKclPath(c.path) === key ||
      c.path.endsWith(`/${key}`) ||
      c.path.endsWith(key)
    );
  });
}

/** Write KCL into a named part (create if missing); activates it. */
export function upsertPartScript(
  doc: CadDoc,
  pathOrName: string | undefined,
  script: string,
): CadDoc {
  const key = (pathOrName ?? "parts/main.kcl").trim();
  const byPath = matchComponent(doc, key, "part");
  if (byPath) {
    return setActiveComponent(updateComponentContent(doc, byPath.id, script), byPath.id);
  }
  const name = key.includes("/") ? displayNameFromCadPath(key) : key.replace(/\.kcl$/, "");
  return addCadComponent(doc, { name, kind: "part", content: script });
}

/**
 * Write several generated parts in one pass. Used by batched/parallel
 * text_to_cad so each result lands in its own component instead of racing
 * for the doc. The last part in the list ends up active.
 */
export function upsertPartScripts(
  doc: CadDoc,
  parts: { partName?: string; script: string }[],
): CadDoc {
  let next = doc;
  for (const part of parts) {
    next = upsertPartScript(next, part.partName, part.script);
  }
  return next;
}

/**
 * Write content into part / assembly / instructions by path or name.
 * Creates a component when missing (kind inferred from path prefix).
 */
export function upsertCadContent(
  doc: CadDoc,
  pathOrName: string | undefined,
  content: string,
): CadDoc {
  const key = (pathOrName ?? "parts/main.kcl").trim();
  let kind: CadComponentKind = "part";
  if (key.startsWith("assembly/") || key.includes("assembly") || key === "product") {
    kind = "assembly";
  } else if (key.startsWith("docs/") || key.endsWith(".md") || key.includes("instruction")) {
    kind = "instructions";
  }

  // Any assembly write lands on the canonical product path.
  const resolveKey = kind === "assembly" ? PRODUCT_ASSEMBLY_PATH : key;
  const existing =
    kind === "assembly"
      ? (matchComponent(doc, PRODUCT_ASSEMBLY_PATH, "assembly") ??
        doc.components.find((c) => c.kind === "assembly"))
      : (matchComponent(doc, resolveKey) ?? matchComponent(doc, resolveKey, kind));
  if (existing) {
    const updated =
      kind === "assembly" && existing.path !== PRODUCT_ASSEMBLY_PATH
        ? {
            ...doc,
            components: doc.components.map((c) =>
              c.id === existing.id
                ? { ...c, name: "product", path: PRODUCT_ASSEMBLY_PATH, content }
                : c,
            ),
          }
        : updateComponentContent(doc, existing.id, content);
    return setActiveComponent(
      kind === "assembly" && existing.path !== PRODUCT_ASSEMBLY_PATH
        ? withMirror(updated)
        : updated,
      existing.id,
    );
  }
  if (kind === "assembly") {
    return addCadComponent(doc, { name: "product", kind: "assembly", content });
  }
  const name = key.includes("/") ? displayNameFromCadPath(key) : key.replace(/\.(kcl|md)$/, "");
  return addCadComponent(doc, { name, kind, content });
}

function isV5(raw: Record<string, unknown>): boolean {
  return (
    raw.version === 5 &&
    raw.engine === "zoo" &&
    typeof raw.activeId === "string" &&
    Array.isArray(raw.components)
  );
}

function normalizeComponent(raw: unknown): CadComponent | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || typeof c.name !== "string" || typeof c.path !== "string") {
    return null;
  }
  if (c.kind !== "part" && c.kind !== "assembly" && c.kind !== "instructions") return null;
  if (typeof c.content !== "string") return null;
  const kind = c.kind;
  // Only parts need the …/main.kcl layout. Assemblies stay at assembly/*.kcl
  // (MCP copies the entry to root main.kcl for execute).
  const path = kind === "part" ? toZooKclPath(c.path) : c.path;
  const rewritten = kind === "instructions" ? c.content : rewriteKclModuleImportPaths(c.content);
  // Older or interrupted saves can leave a structurally valid v5 component
  // with blank KCL. Never hand an empty program to the Zoo executor.
  const content =
    kind === "part" && !rewritten.trim()
      ? DEFAULT_KCL
      : kind === "assembly" && !rewritten.trim()
        ? DEFAULT_ASSEMBLY_KCL
        : rewritten;
  const name =
    kind === "part" && path !== c.path && c.name === "main" ? displayNameFromCadPath(path) : c.name;
  return {
    id: c.id,
    name,
    path,
    kind,
    content,
  };
}

/** Normalizes any persisted MODEL3D doc to a v5 multi-component workspace. */
export function normalizeCadDoc(raw: unknown): CadDoc {
  if (raw && typeof raw === "object") {
    const doc = raw as Record<string, unknown>;

    if (isV5(doc)) {
      const components = (doc.components as unknown[])
        .map(normalizeComponent)
        .filter((c): c is CadComponent => c !== null);
      if (components.length > 0) {
        const activeId = components.some((c) => c.id === doc.activeId)
          ? (doc.activeId as string)
          : components[0]!.id;
        const assets = Array.isArray(doc.assets)
          ? (doc.assets as unknown[]).map(normalizeAsset).filter((a): a is CadAsset => a !== null)
          : undefined;
        return withMirror({
          version: 5,
          engine: "zoo",
          activeId,
          components,
          ...(assets?.length ? { assets } : {}),
        });
      }
    }

    // v4 single-script Zoo docs
    if (
      (doc.version === 4 || doc.engine === "zoo") &&
      typeof doc.script === "string" &&
      doc.script.trim()
    ) {
      return cadDoc(doc.script);
    }

    // Legacy OCCT / JSCAD — keep labeled stub, never present as verified KCL.
    if (typeof doc.script === "string" && doc.script.trim()) {
      const commented = doc.script
        .split("\n")
        .map((l) => `// ${l}`)
        .join("\n");
      return cadDoc(
        `${DEFAULT_KCL}\n// --- previous non-KCL model (needs regeneration) ---\n${commented}\n`,
      );
    }
  }
  return cadDoc(DEFAULT_KCL);
}
