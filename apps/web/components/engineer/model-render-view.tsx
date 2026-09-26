"use client";

import dynamic from "next/dynamic";
import type { CadView, CadMeshAsset } from "@/components/engineer/cad-viewport";

// Three.js WebGL rendering is client-only.
const Inner = dynamic(() => import("./model-render-inner").then((m) => m.ModelRenderInner), {
  ssr: false,
});

export function ModelRenderView({
  engine,
  script,
  view,
  projectId,
  renderToken,
  meshAssets,
  projectFiles,
  entryPath,
  tight,
}: {
  engine?: "build123d" | "zoo";
  script: string;
  view: CadView;
  projectId?: string;
  renderToken?: string;
  meshAssets?: CadMeshAsset[];
  /** Source project, including the selected entry and its part dependencies. */
  projectFiles?: Record<string, string>;
  entryPath?: string;
  /** Card thumbnail: fill the frame and drop the grid/axes. */
  tight?: boolean;
}) {
  return (
    <Inner
      engine={engine}
      script={script}
      view={view}
      projectId={projectId}
      renderToken={renderToken}
      meshAssets={meshAssets}
      projectFiles={projectFiles}
      entryPath={entryPath}
      tight={tight}
    />
  );
}
