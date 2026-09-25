"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { UIMessage } from "ai";
import { useCopilot } from "@/components/copilot/copilot-provider";
import { PROJECT_KICKOFF_KEY } from "@/components/project-create-bar";
import { cn } from "@/lib/utils";

/**
 * Steps shown to a viewer waiting on the "bootstrap this project" prompt.
 * A step lights up once any of its tools has actually completed for this
 * run — not before, and not just because the model said it would. This is a
 * progress indicator, not a correctness gate: a tool that never fires this
 * turn just leaves its step pending, which is the right failure mode.
 */
const KICKOFF_STEPS: { label: string; tools: string[] }[] = [
  { label: "Brief", tools: ["update_brief"] },
  { label: "Requirements", tools: ["add_requirements"] },
  { label: "BOM", tools: ["add_components"] },
  { label: "Circuit", tools: ["save_circuit", "import_wokwi_diagram"] },
  {
    label: "3D model",
    tools: [
      "create_cad_component",
      "text_to_cad",
      "save_cad_script",
      "patch_cad_script",
      "python_cad",
      "add_part_to_assembly",
    ],
  },
  { label: "Checks", tools: ["add_validation_checks"] },
];

type ToolPart = { type: string; state?: string; toolName?: string };

function toolPartName(part: ToolPart): string {
  if (part.type === "dynamic-tool" && typeof part.toolName === "string") return part.toolName;
  return part.type.replace(/^tool-/, "");
}

/** Tool names that completed successfully across a slice of the transcript. */
function completedToolNames(messages: UIMessage[]): Set<string> {
  const names = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts as unknown as ToolPart[]) {
      if (!part.type?.startsWith("tool-") && part.type !== "dynamic-tool") continue;
      if (part.state === "output-available") names.add(toolPartName(part));
    }
  }
  return names;
}

export function PipelineKickoffListener({ hasBrief }: { hasBrief: boolean }) {
  const { send, status, messages } = useCopilot();
  const kickedOff = useRef(false);
  const kickoffStartIndex = useRef(0);
  const everStartedRunning = useRef(false);
  const busy = status === "submitted" || status === "streaming";
  const [showOverlay, setShowOverlay] = useState(false);

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
    kickoffStartIndex.current = messages.length;
    setShowOverlay(true);
    send(
      `@AI Bootstrap this project end-to-end: ${pending.trim()}\n\nFill the brief, requirements, BOM, circuit, 3D model, and validation checks.`,
    );
  }, [hasBrief, busy, send, messages.length]);

  useEffect(() => {
    if (!showOverlay) return;
    if (busy) {
      everStartedRunning.current = true;
      return;
    }
    if (!everStartedRunning.current) return;
    // Run finished (or errored) — let the last checkmark land before fading.
    const timer = setTimeout(() => setShowOverlay(false), 900);
    return () => clearTimeout(timer);
  }, [busy, showOverlay]);

  const done = useMemo(
    () => completedToolNames(messages.slice(kickoffStartIndex.current)),
    [messages],
  );

  if (!showOverlay) return null;

  return (
    <div className="bg-background/90 absolute inset-0 z-40 flex items-center justify-center backdrop-blur-sm">
      <div className="border-border bg-card w-full max-w-xs rounded-none border p-5 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">Building your product…</p>
          <button
            type="button"
            onClick={() => setShowOverlay(false)}
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
          >
            Hide
          </button>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          The copilot is filling in the brief, requirements, BOM, circuit, model, and checks.
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {KICKOFF_STEPS.map((step) => {
            const isDone = step.tools.some((tool) => done.has(tool));
            return (
              <li key={step.label} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border",
                    isDone
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-muted-foreground/40",
                  )}
                >
                  {isDone ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                <span className={isDone ? "text-foreground" : "text-muted-foreground"}>
                  {step.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
