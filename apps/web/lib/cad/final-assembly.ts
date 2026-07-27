/**
 * Builds the virtual KCL project behind Engineer > Assembly: the mechanical
 * doc's assemblies (or standalone parts) plus a SIMULATED PCB, combined into
 * one synthesized entry file so the whole product renders in a single scene.
 * Read-only — nothing here is written back to the stored docs.
 */
import {
  buildKclProject,
  isForeignImportOnlyScript,
  partModuleAlias,
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
  /** Mechanical roots included in the scene (assemblies, or parts when no assembly exists). */
  mechanicalRoots: string[];
  hasPcb: boolean;
};

function mechanicalRoots(doc: CadDoc): CadComponent[] {
  const assemblies = doc.components.filter((c) => c.kind === "assembly" && c.content.trim());
  if (assemblies.length > 0) return assemblies;
  return doc.components.filter(
    (c) => c.kind === "part" && c.content.trim() && !isForeignImportOnlyScript(c.content),
  );
}

export function buildFinalAssembly(cad: CadDoc | null, pcb: PcbDoc | null): FinalAssembly | null {
  const files: Record<string, string> = {};
  const meshAssets: CadViewportMesh[] = [];
  const bodyLines: string[] = [];
  const rootNames: string[] = [];

  const roots = cad ? mechanicalRoots(cad) : [];
  for (const [i, root] of roots.entries()) {
    const build = buildKclProject(cad!, root.path);
    Object.assign(files, build.files);
    for (const asset of build.meshAssets) {
      if (!meshAssets.some((m) => m.path === asset.path)) {
        meshAssets.push(toViewportMesh(asset));
      }
    }
    const alias = `fa${i}_${partModuleAlias(root)}`;
    bodyLines.push(`import "${root.path}" as ${alias}`, alias);
    rootNames.push(root.name);
  }

  if (roots.length === 0 && !pcb) return null;

  const sections: string[] = [
    "// FINAL ASSEMBLY (read-only view) — SIMULATED placement of mechanical parts and PCB.",
    "// Edit parts in the Model editor and the board in the PCB editor.",
  ];
  if (bodyLines.length > 0) sections.push(bodyLines.join("\n"));
  if (pcb) sections.push(pcbAssemblyKcl(pcb, { zOffsetMm: PCB_STANDOFF_MM }));

  const script = sections.join("\n\n") + "\n";
  files[FINAL_ASSEMBLY_PATH] = script;

  return {
    script,
    projectFiles: files,
    entryPath: FINAL_ASSEMBLY_PATH,
    meshAssets,
    mechanicalRoots: rootNames,
    hasPcb: Boolean(pcb),
  };
}
