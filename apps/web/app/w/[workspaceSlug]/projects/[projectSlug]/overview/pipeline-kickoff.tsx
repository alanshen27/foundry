"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
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
    <div className="border-primary/20 from-primary/8 relative overflow-hidden rounded-2xl border bg-gradient-to-br to-transparent p-6">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="text-primary size-4" />
        <h2 className="text-sm font-semibold">
          {hasBrief ? "Ask the copilot to change anything" : "Describe your product"}
        </h2>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            hasBrief
              ? "e.g. Swap the MCU for an ESP32-C3 and update the checks"
              : "e.g. A pocket-size air quality monitor with an e-ink display, under $60"
          }
          aria-label="Describe your product"
          className="placeholder:text-muted-foreground bg-background/70 focus-visible:border-ring focus-visible:ring-ring/50 h-11 flex-1 rounded-xl border px-4 text-sm outline-none focus-visible:ring-3"
        />
        <Button type="submit" size="lg" disabled={!prompt.trim() || busy} className="h-11 px-5">
          {busy ? "Copilot working…" : hasBrief ? "Send" : "Build the pipeline"}
          <ArrowRight className="size-4" />
        </Button>
      </form>
      <p className="text-muted-foreground mt-3 text-xs">
        The copilot fills the brief, requirements, BOM, circuit, 3D model, and checks — then you
        review each stage. Changes that invalidate approved work mark those stages stale.
      </p>
    </div>
  );
}
