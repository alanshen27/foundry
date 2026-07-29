"use client";

import { useEffect, useState } from "react";
import { FoundryMarkIcon } from "@/components/foundry-mark";
import { DotMatrixLoader } from "@/components/dot-matrix-loader";
import { cn } from "@/lib/utils";

/**
 * Video-opener title card: the pulsing dot-glyph field with the Foundry
 * mark + wordmark fading in inline on top. Loops nothing — record and cut.
 */
export function DemoIntro() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 700);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="bg-background fixed inset-0 overflow-hidden">
      <DotMatrixLoader className="absolute inset-0" label="" gap={14} />

      <div className="absolute inset-0 z-10 flex items-center justify-center">
        <div
          className={cn(
            "flex items-center gap-5 transition-all duration-[1400ms] ease-out",
            shown ? "scale-100 opacity-100 blur-0" : "scale-90 opacity-0 blur-sm",
          )}
        >
          <FoundryMarkIcon className="size-16 md:size-20" />
          <span className="text-foreground font-mono text-4xl font-medium tracking-[0.18em] uppercase md:text-5xl">
            Foundry
          </span>
        </div>
      </div>
    </div>
  );
}
