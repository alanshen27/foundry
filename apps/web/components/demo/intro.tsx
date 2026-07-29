"use client";

import { useEffect, useState } from "react";
import { AnimatedSignalGlyph } from "@/components/animated-signal-glyph";
import { InteractiveDotField } from "@/components/interactive-dot-field";
import { cn } from "@/lib/utils";

/**
 * Video-opener title card: the signal-orange panel with the breathing
 * ASCII glyph mark, and the Foundry pixel-mark + wordmark inline on top.
 * The wordmark is editable — click it and type, or pass ?text=Your+Words.
 */
export function DemoIntro({ initialText = "Foundry" }: { initialText?: string }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="bg-primary text-primary-foreground fixed inset-0 overflow-hidden">
      <InteractiveDotField tone="signal" className="absolute inset-0" gap={12} radius={64} />

      <div className="absolute inset-0 z-10 flex items-center justify-center">
        <AnimatedSignalGlyph
          seed="foundry-pulse"
          rows={34}
          cols={52}
          fontSize={15}
          className="opacity-95"
        />
      </div>

      <div className="absolute inset-0 z-20 flex items-center justify-center">
        <div
          className={cn(
            "flex items-center gap-5 transition-all duration-1000 ease-out",
            shown ? "scale-100 opacity-100 blur-0" : "scale-95 opacity-0 blur-sm",
          )}
        >
          <span className="inline-grid grid-cols-3 gap-[5px]" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="size-[9px] bg-[#faf9f5] md:size-[11px]" />
            ))}
          </span>
          <span
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            className="font-mono text-5xl font-medium tracking-[0.2em] whitespace-pre uppercase outline-none md:text-6xl"
          >
            {initialText}
          </span>
        </div>
      </div>
    </div>
  );
}
