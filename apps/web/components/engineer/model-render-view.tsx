"use client";

import dynamic from "next/dynamic";
import type { CadView } from "@/components/engineer/cad-viewport";

// Zoo WebRTC + WebGL are client-only.
const Inner = dynamic(
  () => import("./model-render-inner").then((m) => m.ModelRenderInner),
  { ssr: false },
);

export function ModelRenderView({
  script,
  view,
  engineToken,
  engineBaseUrl,
  projectFiles,
  entryPath,
}: {
  script: string;
  view: CadView;
  engineToken: string;
  engineBaseUrl?: string;
  /** Multi-file KCL project — required for assemblies that import parts. */
  projectFiles?: Record<string, string>;
  entryPath?: string;
}) {
  return (
    <Inner
      script={script}
      view={view}
      engineToken={engineToken}
      engineBaseUrl={engineBaseUrl}
      projectFiles={projectFiles}
      entryPath={entryPath}
    />
  );
}
