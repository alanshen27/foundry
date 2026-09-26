"use client";
import { useCadDrafts } from "@/components/copilot/cad-draft-context";

/** Never apply incomplete KCL to the saved model or ask the engine to compile each token. */
export function LiveCadDrafts() {
  const drafts = useCadDrafts();
  if (!drafts.length) return null;
  return (
    <details
      className="absolute bottom-4 left-4 z-20 max-h-[45%] w-[min(36rem,calc(100%-2rem))] overflow-auto border bg-background/95 p-3 shadow-lg"
      data-testid="live-cad-drafts"
    >
      <summary className="cursor-pointer text-xs font-medium">
        AI is writing {drafts.length} {drafts.length === 1 ? "file" : "files"} · live draft
      </summary>
      <p className="my-2 text-xs text-muted-foreground">
        Source streams here while the saved design stays visible. Editors update after the tool
        finishes validation and saves its result.
      </p>
      {drafts.map((draft) => (
        <div key={`${draft.toolCallId}:${draft.path}`}>
          <div className="py-1 text-xs font-medium">
            {draft.path} · {draft.content.length.toLocaleString()} characters
            {draft.truncated ? " · preview truncated" : ""}
          </div>
          <pre className="max-h-52 overflow-auto bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">
            {draft.content || "Waiting for source…"}
          </pre>
        </div>
      ))}
    </details>
  );
}
