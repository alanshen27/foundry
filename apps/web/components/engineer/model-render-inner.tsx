"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CadViewport, type CadView, type CadMeshAsset } from "@/components/engineer/cad-viewport";

function markReady() {
  document.body.dataset.renderReady = "1";
}

function markNotReady() {
  delete document.body.dataset.renderReady;
}

/** Fixed-camera model view for headless screenshots (copilot vision loop). */
export function ModelRenderInner({
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
  projectFiles?: Record<string, string>;
  entryPath?: string;
  tight?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReady = useCallback(() => {
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    markReady();
  }, []);
  const onError = useCallback((message: string | null) => {
    setError(message);
    // Errors still count as "ready" so the screenshot captures the error overlay
    // instead of timing out — but only after the viewport reported the failure.
    if (message) {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
      markReady();
    } else markNotReady();
  }, []);

  useEffect(() => {
    markNotReady();
    // Show a visible failure if a stalled decoder never reports a result.
    fallbackTimer.current = setTimeout(() => {
      setError("The model preview timed out. Retry the render.");
      markReady();
    }, 155_000);
    return () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    };
  }, [engine, script, entryPath, view]);

  return (
    <div className="absolute inset-0">
      <CadViewport
        engine={engine}
        script={script}
        projectId={projectId}
        renderToken={renderToken}
        meshAssets={meshAssets}
        view={view}
        chrome={false}
        headless
        projectFiles={projectFiles}
        entryPath={entryPath}
        fitPadding={tight ? 0.01 : undefined}
        scenery={!tight}
        onReady={onReady}
        onError={onError}
      />
      {error ? (
        <div className="text-destructive absolute inset-x-0 top-0 z-10 bg-background/90 p-3 font-mono text-xs">
          CAD error: {error}
        </div>
      ) : null}
      {tight ? null : (
        <span className="text-muted-foreground absolute bottom-2 left-3 z-10 text-xs uppercase">
          {view}
        </span>
      )}
    </div>
  );
}
