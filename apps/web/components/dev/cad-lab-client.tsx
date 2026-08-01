"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  parseEventLines,
  type CadLabEvent,
  type CadLabPhase,
  type CadLabRender,
  type CadLabRequest,
  type CadLabResponse,
} from "@/lib/cad-lab";

const PLACEHOLDER =
  "Describe a part or assembly, e.g. “A 40mm x 40mm x 10mm mounting bracket with four 4mm corner holes”";

const PHASE_LABEL: Record<CadLabPhase, string> = {
  generate: "Generating on Zoo",
  execute: "Executing KCL in the engine",
  snapshot: "Rendering snapshots",
};

type Run = {
  id: number;
  prompt: string;
  startedAt: number;
  phase: CadLabPhase;
  /** Latest narration from Zoo, so a long run shows what it is doing. */
  note?: string;
  result?: CadLabResponse;
};

/**
 * Run the lab and surface progress as it arrives.
 *
 * `zoo_prompt_render` streams NDJSON because it takes minutes; other actions
 * still answer with a single JSON body.
 */
async function streamCadLab(
  body: CadLabRequest,
  signal: AbortSignal,
  onEvent: (event: CadLabEvent) => void,
): Promise<CadLabResponse> {
  const res = await fetch("/api/dev/cad-lab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const isStream = res.headers.get("content-type")?.includes("ndjson") && res.body;
  if (!isStream) return (await res.json()) as CadLabResponse;

  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let result: CadLabResponse | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      const parsed = parseEventLines(buffer + value);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        if (event.type === "result") result = event.response;
        else onEvent(event);
      }
    }
    if (done) break;
  }
  return result ?? { ok: false, error: "CAD Lab stream ended without a result" };
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function RunProgress({ run, onCancel }: { run: Run; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - run.startedAt);
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - run.startedAt), 1000);
    return () => clearInterval(t);
  }, [run.startedAt]);

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        <span className="animate-pulse">{PHASE_LABEL[run.phase]}</span> · {fmtMs(elapsed)}
      </p>
      {run.note ? (
        <p className="border-l-2 border-border pl-3 text-xs text-muted-foreground italic">
          {run.note}
        </p>
      ) : null}
      <Button variant="ghost" size="xs" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function RenderCard({ run, onCancel }: { run: Run; onCancel: () => void }) {
  const r = run.result;
  return (
    <div className="space-y-3 border border-border bg-card p-4">
      <p className="text-sm font-medium">{run.prompt}</p>
      {!r ? (
        <RunProgress run={run} onCancel={onCancel} />
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
  const abortRef = useRef<AbortController | null>(null);

  const patch = (id: number, changes: Partial<Run>) =>
    setRuns((prev) => prev.map((run) => (run.id === id ? { ...run, ...changes } : run)));

  const generate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const id = Date.now();
    setRuns((prev) => [{ id, prompt: trimmed, startedAt: id, phase: "generate" }, ...prev]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await streamCadLab(
        { action: "zoo_prompt_render", prompt: trimmed },
        controller.signal,
        (event) => {
          if (event.type === "phase") patch(id, { phase: event.phase });
          if (event.type === "note") patch(id, { note: event.text });
        },
      );
      patch(id, { result });
    } catch (err) {
      const cancelled = err instanceof Error && err.name === "AbortError";
      patch(id, {
        result: {
          ok: false,
          error: cancelled ? "Cancelled." : err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      abortRef.current = null;
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
        {runs.map((run) => (
          <RenderCard key={run.id} run={run} onCancel={() => abortRef.current?.abort()} />
        ))}
      </div>
    </div>
  );
}
