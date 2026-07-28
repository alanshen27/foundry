"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopilot } from "@/components/copilot/copilot-provider";

/**
 * The "describe it" box: one prompt bootstraps the whole pipeline via the
 * copilot (brief -> requirements -> BOM -> circuit -> model -> checks).
 */
export function PipelineKickoff({ hasBrief }: { hasBrief: boolean }) {
  const { send, status } = useCopilot();
  const [prompt, setPrompt] = useState("");
  const busy = status === "submitted" || status === "streaming";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    send(
      hasBrief
        ? prompt.trim()
        : `Bootstrap this project end-to-end: ${prompt.trim()}\n\nFill the brief, requirements, BOM, circuit, 3D model, and validation checks.`,
    );
    setPrompt("");
  }

  return (
    <div className="border-border bg-card relative overflow-hidden border">
      <div className="bg-primary absolute top-0 bottom-0 left-0 w-1" aria-hidden />
      <div className="px-5 py-4 pl-6">
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
          Copilot
        </p>
        <h2 className="mt-1 font-mono text-[15px] font-medium tracking-[-0.02em]">
          {hasBrief ? "Ask the copilot to change anything" : "Describe your product"}
        </h2>
        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-2.5 sm:flex-row">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              hasBrief
                ? "e.g. Swap the MCU for an ESP32-C3 and update the checks"
                : "e.g. A pocket-size air quality monitor with an e-ink display, under $60"
            }
            aria-label="Describe your product"
            className="placeholder:text-muted-foreground bg-background focus-visible:border-primary h-9 flex-1 border px-3 font-mono text-[13px] outline-none"
          />
          <Button
            type="submit"
            disabled={!prompt.trim() || busy}
            className="h-9 rounded-none px-4 font-mono text-[12px] tracking-[0.08em] uppercase"
          >
            {busy ? "Working…" : hasBrief ? "Send" : "Build"}
            <ArrowRight className="size-3.5" />
          </Button>
        </form>
        <p className="text-muted-foreground mt-3 font-mono text-[11px] leading-relaxed">
          Brief · requirements · BOM · circuit · model · checks — then you review each stage.
        </p>
      </div>
    </div>
  );
}
