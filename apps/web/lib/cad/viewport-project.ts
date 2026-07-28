/**
 * Chooses what the Zoo viewport is asked to build for a given CAD component.
 *
 * The distinction matters: a component that imports other modules only renders
 * when the whole workspace is submitted as a multi-file project, because the
 * engine resolves `import "parts/x.kcl"` against the submitted file map. Sending
 * just the active file leaves an assembly with nothing to draw.
 */
import {
  buildKclProject,
  isForeignImportOnlyScript,
  parseForeignImports,
  parseKclModuleImports,
  type CadAsset,
  type CadDoc,
} from "./engine";

/** Structurally matches `CadMeshAsset` in the viewport component. */
export type CadViewportMesh = {
  path: string;
  format: string;
  fileUrl: string;
  lengthUnit?: "mm" | "cm" | "m" | "in" | "ft" | "yd";
};

export type CadViewportInput = {
  script: string;
  /** Present only for multi-file submits. */
  projectFiles?: Record<string, string>;
  entryPath?: string;
  meshAssets: CadViewportMesh[];
  /** Script is nothing but foreign mesh imports — skip the KCL submit. */
  foreignImportOnly: boolean;
};

/** Stored mesh → viewport asset. KCL's foreign imports can't be resolved by the
 *  browser, so the engine is handed the bytes over the authenticated file route. */
export function toViewportMesh(asset: CadAsset): CadViewportMesh {
  return {
    path: asset.path,
    format: asset.format,
    fileUrl: `/api/files/${asset.storageKey}`,
    ...(asset.lengthUnit ? { lengthUnit: asset.lengthUnit } : {}),
  };
}

export function cadViewportInput(doc: CadDoc, activeId: string): CadViewportInput | null {
  const entry = doc.components.find((c) => c.id === activeId);
  if (!entry || entry.kind === "instructions") return null;

  if (parseKclModuleImports(entry.content).length > 0) {
    const project = buildKclProject(doc, entry.path);
    return {
      // Prefer remapped entry source so import paths match projectFiles keys.
      script: project.files[project.entryPath] ?? entry.content,
      projectFiles: project.files,
      entryPath: project.entryPath,
      meshAssets: project.meshAssets.map(toViewportMesh),
      foreignImportOnly: false,
    };
  }

  // A standalone part submits as a single file, which the engine builds faster.
  const assets = doc.assets ?? [];
  const meshAssets = parseForeignImports(entry.content)
    .map(({ path }) => assets.find((a) => a.path === path))
    .filter((a): a is CadAsset => Boolean(a))
    .map(toViewportMesh);

  return {
    script: entry.content,
    meshAssets,
    foreignImportOnly: isForeignImportOnlyScript(entry.content),
  };
}
