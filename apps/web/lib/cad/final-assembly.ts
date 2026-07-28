/**
 * Builds the virtual KCL project behind Engineer > Assembly.
 *
 * Geometry is rendered by importing the product **assembly** module(s) plus a
 * SIMULATED PCB. Zoo's module rules require subdirectory imports to target
 * `…/main.kcl` — buildKclProject / toZooKclPath handle that remapping.
 * The scene list still exposes every part for open-in-editor.
 */
import {
  buildKclProject,
  isForeignImportOnlyScript,
  meshPartProxyKcl,
  parseForeignImports,
  parseKclModuleImports,
  partModuleAlias,
  toZooKclPath,
  fromZooKclPath,
  type CadComponent,
  type CadDoc,
} from "./engine";
import { toViewportMesh, type CadViewportMesh } from "./viewport-project";
import { pcbAssemblyKcl } from "@/lib/pcb/kcl";
import type { PcbDoc } from "@/lib/pcb/doc";

export const FINAL_ASSEMBLY_PATH = "assembly/__final-assembly.kcl";
/** Standoff height the PCB is lifted by inside the scene. */
export const PCB_STANDOFF_MM = 2;

export type FinalAssembly = {
  script: string;
  projectFiles: Record<string, string>;
  entryPath: string;
  meshAssets: CadViewportMesh[];
  /** Part names shown in the scene list (open-in-editor targets). */
  mechanicalRoots: string[];
  /** CadDoc component ids parallel to mechanicalRoots. */
  mechanicalRootIds: string[];
  hasPcb: boolean;
};

/** Parts listed in the Assembly UI (hover → open CAD). */
export function sceneParts(doc: CadDoc): CadComponent[] {
  const parts = doc.components.filter((c) => c.kind === "part" && c.content.trim());
  if (parts.length > 0) return parts;
  return doc.components.filter((c) => c.kind === "assembly" && c.content.trim());
}

/**
 * What we actually import into the Zoo scene. Prefer product assemblies — they
 * already import parts correctly from the same project layout the Model editor uses.
 */
export function renderRoots(doc: CadDoc): CadComponent[] {
  const assemblies = doc.components.filter((c) => c.kind === "assembly" && c.content.trim());
  if (assemblies.length > 0) return assemblies;
  // No assembly yet — fall back to standalone parts (same as a fresh workspace).
  return doc.components.filter(
    (c) => c.kind === "part" && c.content.trim() && !isForeignImportOnlyScript(c.content),
  );
}

function projectFilesForScene(cad: CadDoc, roots: CadComponent[]): {
  files: Record<string, string>;
  meshAssets: CadViewportMesh[];
} {
  const importedLogical = new Set(roots.map((r) => r.path));
  for (const root of roots) {
    for (const imp of parseKclModuleImports(root.content)) {
      importedLogical.add(fromZooKclPath(imp.path));
    }
  }

  const files: Record<string, string> = {};
  const meshAssets: CadViewportMesh[] = [];
  if (roots[0]) {
    const build = buildKclProject(cad, roots[0].path);
    Object.assign(files, build.files);
    for (const asset of build.meshAssets) {
      meshAssets.push(toViewportMesh(asset));
    }
  }
  for (const c of cad.components) {
    if (c.kind === "instructions") continue;
    const outPath = toZooKclPath(c.path);
    const foreign = parseForeignImports(c.content);
    if (c.kind === "part" && importedLogical.has(c.path) && foreign.length > 0) {
      files[outPath] = meshPartProxyKcl(c.name);
    } else if (!files[outPath]) {
      files[outPath] = c.content;
    }
  }

  return { files, meshAssets };
}

export function buildFinalAssembly(cad: CadDoc | null, pcb: PcbDoc | null): FinalAssembly | null {
  const roots = cad ? renderRoots(cad) : [];
  const listParts = cad ? sceneParts(cad) : [];
  if (roots.length === 0 && listParts.length === 0 && !pcb) return null;

  const importLines: string[] = [];
  const placeLines: string[] = [];

  for (const [i, root] of roots.entries()) {
    const alias = `fa${i}_${partModuleAlias(root)}`;
    importLines.push(`import "${toZooKclPath(root.path)}" as ${alias}`);
    placeLines.push(alias);
  }

  const { files, meshAssets } = cad
    ? projectFilesForScene(cad, roots)
    : { files: {} as Record<string, string>, meshAssets: [] as CadViewportMesh[] };

  const sections: string[] = [
    "// FINAL ASSEMBLY (read-only) — product assembly + SIMULATED PCB.",
    "// Scene list still links every part; geometry comes from the assembly module.",
  ];
  if (importLines.length > 0) {
    sections.push(importLines.join("\n"));
    sections.push(placeLines.join("\n"));
  }
  if (pcb) sections.push(pcbAssemblyKcl(pcb, { zOffsetMm: PCB_STANDOFF_MM }));

  const script = sections.join("\n\n") + "\n";
  files[FINAL_ASSEMBLY_PATH] = script;

  const list = listParts.length > 0 ? listParts : roots;

  return {
    script,
    projectFiles: files,
    entryPath: FINAL_ASSEMBLY_PATH,
    meshAssets,
    mechanicalRoots: list.map((c) => c.name),
    mechanicalRootIds: list.map((c) => c.id),
    hasPcb: Boolean(pcb),
  };
}

/** @deprecated use sceneParts */
export function mechanicalRoots(doc: CadDoc): CadComponent[] {
  return sceneParts(doc).filter((c) => !isForeignImportOnlyScript(c.content) || c.kind === "part");
}
