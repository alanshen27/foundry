"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignalGlowBackdrop } from "@/components/signal-glow-backdrop";
import { useCopilot } from "@/components/copilot/copilot-provider";
import { PROJECT_KICKOFF_KEY } from "@/components/project-create-bar";

/**
 * Overview create/ask surface — same signal glow + white form as Sites /
 * project create (orange radial wash, dual-scale dots, sharp chrome).
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
    <section className="relative">
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-2 py-8 text-center sm:py-12">
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.18em] uppercase">
          {hasBrief ? "Copilot" : "Create"}
        </p>
        <h2 className="mt-3 font-mono text-[clamp(1.75rem,4vw,2.75rem)] leading-[1.05] font-medium tracking-[-0.04em]">
          {hasBrief ? "Ask the copilot to change anything" : "Build something Foundry"}
        </h2>
        <p className="text-muted-foreground mt-3 max-w-lg text-[15px] leading-relaxed">
          {hasBrief
            ? "One message updates brief, BOM, circuit, CAD, and checks."
            : "Describe the product. AI fills the pipeline — then you review each stage."}
        </p>

        <form onSubmit={onSubmit} className="relative mt-8 w-full">
          <SignalGlowBackdrop />

          <div className="border-border relative z-10 border bg-white text-left transition-colors focus-within:border-primary dark:bg-card">
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
              rows={hasBrief ? 3 : 4}
              className="placeholder:text-muted-foreground min-h-[96px] w-full resize-none bg-transparent px-4 py-4 text-[15px] leading-relaxed outline-none disabled:opacity-60"
              disabled={busy}
            />
            <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2.5">
              <span className="text-muted-foreground hidden font-mono text-[10px] tracking-[0.12em] uppercase sm:inline">
                Brief · BOM · circuit · model · checks
              </span>
              <Button
                type="submit"
                disabled={!prompt.trim() || busy}
                className="ml-auto rounded-none px-5 font-mono text-[12px] tracking-[0.1em] uppercase"
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
    </section>
  );
}
