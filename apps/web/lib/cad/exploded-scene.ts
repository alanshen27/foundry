/**
 * Virtual KCL project for Engineer > Assembly: one import per real part file,
 * fanned out on X so each solid is separately visible. Hover lifts a part by
 * regenerating this entry (Zoo re-executes on the live WebRTC session).
 *
 * Not written back to CadDoc — same parts the Model editor already stores.
 */
import {
  meshPartProxyKcl,
  parseForeignImports,
  parseKclModuleImports,
  partModuleAlias,
  toZooKclPath,
  type CadComponent,
  type CadDoc,
} from "./engine";
import { toViewportMesh, type CadViewportMesh } from "./viewport-project";

export const EXPLODED_SCENE_PATH = "assembly/__exploded-scene.kcl";

/** Default gap between part origins along +X (mm). */
export const EXPLODED_SPACING_MM = 80;
/** Extra +Z when a part is hovered in the scene list (mm). */
export const EXPLODED_HOVER_LIFT_MM = 24;

export type ExplodedScene = {
  script: string;
  projectFiles: Record<string, string>;
  entryPath: string;
  meshAssets: CadViewportMesh[];
  parts: CadComponent[];
};

/** Drawable part components — skip empty / instructions. */
export function explodedParts(doc: CadDoc): CadComponent[] {
  return doc.components.filter((c) => c.kind === "part" && c.content.trim());
}

function partSourceForModule(part: CadComponent): string {
  // Browser Zoo can't resolve STL/STEP inside imported modules — same proxy
  // the Model editor uses when an assembly imports a mesh part.
  if (parseForeignImports(part.content).length > 0) {
    return meshPartProxyKcl(part.name);
  }
  const trimmed = part.content.trimEnd();
  // Whole-module import uses the default export (last value). Assignments alone
  // are fine in Zoo; if the file is import-only stubs we already proxied above.
  return `${trimmed}\n`;
}

function buildProjectFiles(cad: CadDoc, parts: CadComponent[]): {
  files: Record<string, string>;
  meshAssets: CadViewportMesh[];
} {
  const files: Record<string, string> = {};
  const meshAssets: CadViewportMesh[] = [];
  const assetsByPath = new Map((cad.assets ?? []).map((a) => [a.path, a]));
  const partPaths = new Set(parts.map((p) => p.path));

  for (const c of cad.components) {
    if (c.kind === "instructions") continue;
    const outPath = toZooKclPath(c.path);
    if (partPaths.has(c.path) && c.kind === "part") {
      files[outPath] = partSourceForModule(c);
      for (const f of parseForeignImports(c.content)) {
        const asset = assetsByPath.get(f.path);
        if (asset && !meshAssets.some((m) => m.path === asset.path)) {
          meshAssets.push(toViewportMesh(asset));
        }
      }
    } else {
      files[outPath] = c.content;
    }
  }

  // Nested KCL imports from any part (rare) must be present in the file map.
  for (const part of parts) {
    for (const imp of parseKclModuleImports(part.content)) {
      const zooPath = toZooKclPath(imp.path);
      if (files[zooPath] || files[imp.path]) continue;
      const dep = cad.components.find(
        (c) => c.path === imp.path || toZooKclPath(c.path) === zooPath,
      );
      if (dep) files[toZooKclPath(dep.path)] = dep.content;
    }
  }

  return { files, meshAssets };
}

/**
 * Build the exploded multi-file project. When `focusPartId` is set, that part
 * is lifted on Z so list-hover reads in the 3D stream without entity-ID mapping.
 */
export function buildExplodedScene(
  cad: CadDoc | null,
  opts?: {
    focusPartId?: string | null;
    spacingMm?: number;
    liftMm?: number;
  },
): ExplodedScene | null {
  if (!cad) return null;
  const parts = explodedParts(cad);
  if (parts.length === 0) return null;

  const spacing = opts?.spacingMm ?? EXPLODED_SPACING_MM;
  const lift = opts?.liftMm ?? EXPLODED_HOVER_LIFT_MM;
  const focusId = opts?.focusPartId ?? null;

  const importLines: string[] = [];
  const placeLines: string[] = [];

  for (const [i, part] of parts.entries()) {
    const alias = `ex${i}_${partModuleAlias(part)}`;
    importLines.push(`import "${toZooKclPath(part.path)}" as ${alias}`);
    const x = i * spacing;
    const z = focusId && part.id === focusId ? lift : 0;
    if (x === 0 && z === 0) {
      placeLines.push(alias);
    } else if (z === 0) {
      placeLines.push(`${alias} |> translate(x = ${x})`);
    } else if (x === 0) {
      placeLines.push(`${alias} |> translate(z = ${z})`);
    } else {
      placeLines.push(`${alias} |> translate(x = ${x}, z = ${z})`);
    }
  }

  const { files, meshAssets } = buildProjectFiles(cad, parts);
  const script = [
    "// EXPLODED SCENE (read-only) — one instance per parts/*.kcl.",
    "// Generated for Assembly home hover; not saved to the CadDoc.",
    "",
    importLines.join("\n"),
    "",
    placeLines.join("\n"),
    "",
  ].join("\n");

  files[EXPLODED_SCENE_PATH] = script;

  return {
    script,
    projectFiles: files,
    entryPath: EXPLODED_SCENE_PATH,
    meshAssets,
    parts,
  };
}
