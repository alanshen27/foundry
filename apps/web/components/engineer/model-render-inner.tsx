"use client";

import { useCallback, useEffect, useState } from "react";
import { CadViewport, type CadView } from "@/components/engineer/cad-viewport";

function markReady() {
  document.body.dataset.renderReady = "1";
}

/** Fixed-camera model view for headless screenshots (copilot vision loop). */
export function ModelRenderInner({
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
  projectFiles?: Record<string, string>;
  entryPath?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const onReady = useCallback(() => markReady(), []);
  const onError = useCallback((message: string | null) => {
    setError(message);
    if (message) markReady();
  }, []);

  useEffect(() => {
    // Safety: never block the screenshot worker forever.
    const t = setTimeout(markReady, 60_000);
    return () => clearTimeout(t);
  }, []);

  if (!engineToken) {
    markReady();
    return (
      <div className="text-destructive flex h-full items-center justify-center p-8 text-sm">
        ZOO_API_TOKEN is not configured on the server.
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <CadViewport
        script={script}
        engine={{ token: engineToken, baseUrl: engineBaseUrl }}
        view={view}
        chrome={false}
        projectFiles={projectFiles}
        entryPath={entryPath}
        onReady={onReady}
        onError={onError}
      />
      {error ? (
        <div className="text-destructive absolute inset-x-0 top-0 z-10 bg-background/90 p-3 font-mono text-xs">
          CAD error: {error}
        </div>
      ) : null}
      <span className="text-muted-foreground absolute bottom-2 left-3 z-10 text-xs uppercase">
        {view}
      </span>
    </div>
  );
}
