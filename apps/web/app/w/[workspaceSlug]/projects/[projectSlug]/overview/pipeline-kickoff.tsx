"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InteractiveDotField } from "@/components/interactive-dot-field";
import { useCopilot } from "@/components/copilot/copilot-provider";
import { PROJECT_KICKOFF_KEY } from "@/components/project-create-bar";

/**
 * Lovable-style creation box: one big prompt bootstraps the pipeline
 * (brief → requirements → BOM → circuit → model → checks).
 */
export function PipelineKickoff({ hasBrief }: { hasBrief: boolean }) {
  const { send, status } = useCopilot();
  const [prompt, setPrompt] = useState("");
  const kickedOff = useRef(false);
  const busy = status === "submitted" || status === "streaming";

  function bootstrap(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    send(
      hasBrief
        ? trimmed
        : `Bootstrap this project end-to-end: ${trimmed}\n\nFill the brief, requirements, BOM, circuit, 3D model, and validation checks.`,
    );
    setPrompt("");
  }

  // After create-from-projects-page, auto-start the pipeline once.
  useEffect(() => {
    if (hasBrief || kickedOff.current || busy) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PROJECT_KICKOFF_KEY);
      if (pending) sessionStorage.removeItem(PROJECT_KICKOFF_KEY);
    } catch {
      return;
    }
    if (!pending?.trim()) return;
    kickedOff.current = true;
    bootstrap(pending);
  }, [hasBrief, busy]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    bootstrap(prompt);
  }

  return (
    <div className="border-border bg-card relative overflow-hidden border">
      <div className="pointer-events-none absolute inset-0 opacity-35">
        <InteractiveDotField gap={16} radius={52} className="absolute inset-0" />
      </div>
      <div className="bg-primary absolute top-0 bottom-0 left-0 w-1" aria-hidden />

      <div className="relative z-10 mx-auto max-w-3xl px-6 py-10 sm:py-12">
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.18em] uppercase">
          {hasBrief ? "Copilot" : "Create"}
        </p>
        <h2 className="mt-2 font-mono text-[clamp(1.35rem,3vw,1.85rem)] leading-[1.1] font-medium tracking-[-0.03em]">
          {hasBrief ? "Ask the copilot to change anything" : "Build something Foundry"}
        </h2>
        <p className="text-muted-foreground mt-2 max-w-xl text-[14px] leading-relaxed">
          {hasBrief
            ? "One message updates brief, BOM, circuit, CAD, and checks."
            : "Describe the product. AI fills the pipeline — then you review each stage."}
        </p>

        <form onSubmit={onSubmit} className="mt-6">
          <div className="border-border bg-background focus-within:border-primary border transition-colors">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSubmit(e);
                }
              }}
              placeholder={
                hasBrief
                  ? "e.g. Swap the MCU for an ESP32-C3 and update the checks"
                  : "e.g. A pocket-size air quality monitor with an e-ink display, under $60"
              }
              aria-label={hasBrief ? "Ask the copilot" : "Describe your product"}
              rows={hasBrief ? 2 : 3}
              className="placeholder:text-muted-foreground min-h-[72px] w-full resize-none bg-transparent px-4 py-3.5 text-[15px] leading-relaxed outline-none"
            />
            <div className="border-border flex items-center justify-between gap-3 border-t px-3 py-2">
              <span className="text-muted-foreground hidden font-mono text-[10px] tracking-[0.12em] uppercase sm:inline">
                Brief · BOM · circuit · model · checks
              </span>
              <Button
                type="submit"
                disabled={!prompt.trim() || busy}
                className="ml-auto h-9 rounded-none px-4 font-mono text-[12px] tracking-[0.1em] uppercase"
              >
                {busy ? (
                  "Working…"
                ) : (
                  <>
                    {hasBrief ? (
                      <ArrowRight className="size-3.5" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    {hasBrief ? "Send" : "Build"}
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
