import "server-only";
import { buildPythonProject, isPythonCadComponent, type CadDoc } from "@foundry/cad";
import { compileCadModel } from "./cad-mesh";

/** Geometry tools share immutable source snapshots and an authorized asset loader. */
export function evaluateCadComponent(
  doc: CadDoc,
  componentId: string,
  projectId: string,
  signal = new AbortController().signal,
) {
  const component = doc.components.find((part) => part.id === componentId);
  if (!component || !isPythonCadComponent(component))
    throw new Error(
      "Convert this KCL part to Python/build123d before evaluating it. Its source is preserved.",
    );
  const project = buildPythonProject(doc, component.path);
  return compileCadModel(
    {
      engine: "build123d",
      projectId,
      script: project.files[project.entryPath]!,
      projectFiles: project.files,
      entryPath: project.entryPath,
      meshAssets: project.meshAssets.map((asset) => ({
        path: asset.path,
        fileUrl: `/api/files/${asset.storageKey}`,
        format: asset.format,
        lengthUnit: asset.lengthUnit,
      })),
    },
    projectId,
    signal,
  );
}
