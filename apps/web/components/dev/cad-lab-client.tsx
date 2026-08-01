"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CadLabRender, CadLabRequest, CadLabResponse } from "@/lib/cad-lab";

const PLACEHOLDER =
  "Describe a part or assembly, e.g. “A 40mm x 40mm x 10mm mounting bracket with four 4mm corner holes”";

type Run = {
  prompt: string;
  startedAt: number;
  result?: CadLabResponse;
};

async function runCadLab(body: CadLabRequest): Promise<CadLabResponse> {
  const res = await fetch("/api/dev/cad-lab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as CadLabResponse;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function RenderCard({ run }: { run: Run }) {
  const r = run.result;
  return (
    <div className="space-y-3 border border-border bg-card p-4">
      <p className="text-sm font-medium">{run.prompt}</p>
      {!r ? (
        <p className="animate-pulse text-sm text-muted-foreground">
          Generating on Zoo… this regularly takes 1–5+ minutes.
        </p>
      ) : !r.ok ? (
        <pre className="max-h-48 overflow-auto border border-destructive/40 bg-destructive/10 p-3 text-xs whitespace-pre-wrap text-destructive">
          {r.error}
        </pre>
      ) : r.kind !== "render" ? null : (
        <RenderResult r={r} />
      )}
    </div>
  );
}

function RenderResult({ r }: { r: CadLabRender }) {
  const [showKcl, setShowKcl] = useState(false);
  const paths = Object.keys(r.files);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant={r.executeOk ? "secondary" : "destructive"}>
          {r.executeOk ? "KCL executes" : "KCL failed"}
        </Badge>
        {paths.length > 1 ? <Badge variant="outline">{paths.length}-file project</Badge> : null}
        <Badge variant="outline">generate {fmtMs(r.timings.generateMs)}</Badge>
        <Badge variant="outline">execute {fmtMs(r.timings.executeMs)}</Badge>
        <Badge variant="outline">snapshots {fmtMs(r.timings.snapshotMs)}</Badge>
      </div>
      {r.images.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {r.images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={i === 0 ? "Multiview snapshot" : "Isometric snapshot"}
              className="w-full border border-border bg-white"
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No snapshots returned.</p>
      )}
      {!r.executeOk ? (
        <pre className="max-h-40 overflow-auto border border-destructive/40 bg-destructive/10 p-3 text-xs whitespace-pre-wrap text-destructive">
          {r.executeMessage}
        </pre>
      ) : null}
      <Button variant="ghost" size="xs" onClick={() => setShowKcl((v) => !v)}>
        {showKcl ? "Hide KCL" : "Show KCL"}
      </Button>
      {showKcl
        ? paths.map((filePath) => (
            <div key={filePath} className="space-y-1">
              <p className="font-mono text-xs text-muted-foreground">{filePath}</p>
              <pre className="max-h-96 overflow-auto border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                {r.files[filePath]}
              </pre>
            </div>
          ))
        : null}
    </div>
  );
}

export function CadLabClient() {
  const [prompt, setPrompt] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const run: Run = { prompt: trimmed, startedAt: Date.now() };
    setRuns((prev) => [run, ...prev]);
    try {
      const result = await runCadLab({ action: "zoo_prompt_render", prompt: trimmed });
      setRuns((prev) => prev.map((x) => (x === run ? { ...x, result } : x)));
    } catch (err) {
      const result: CadLabResponse = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      setRuns((prev) => prev.map((x) => (x === run ? { ...x, result } : x)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">CAD Lab</h1>
        <Badge variant="outline">DEV ONLY</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        One prompt → Zoo ML text-to-CAD → engine-rendered snapshots. Requires{" "}
        <code>ZOO_API_TOKEN</code> and <code>uvx</code> on PATH. Output is raw engine/ML output —
        UNVERIFIED, not engineering evidence.
      </p>

      <div className="space-y-2">
        <Textarea
          rows={3}
          placeholder={PLACEHOLDER}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void generate();
          }}
        />
        <div className="flex items-center gap-3">
          <Button disabled={busy || !prompt.trim()} onClick={() => void generate()}>
            {busy ? "Generating…" : "Generate"}
          </Button>
          <span className="text-xs text-muted-foreground">Ctrl/Cmd+Enter to run</span>
        </div>
      </div>

      <div className="space-y-4">
        {runs.map((run, i) => (
          <RenderCard key={runs.length - i} run={run} />
        ))}
      </div>
    </div>
  );
}
