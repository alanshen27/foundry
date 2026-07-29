"use client";

import { useEffect, useState } from "react";
import { AnimatedSignalGlyph } from "@/components/animated-signal-glyph";
import { FoundryMarkIcon } from "@/components/foundry-mark";
import { InteractiveDotField } from "@/components/interactive-dot-field";
import { cn } from "@/lib/utils";

/**
 * Video-opener title card: the signal-orange panel with the breathing
 * ASCII glyph mark, and the Foundry logo + wordmark inline on top. The
 * wordmark types itself out, then stays editable — click it and type, or
 * pass ?text=Your+Words.
 */
export function DemoIntro({ initialText = "Foundry" }: { initialText?: string }) {
  const [shown, setShown] = useState(false);
  const [typed, setTyped] = useState(0);
  const [text, setText] = useState(initialText);
  const done = typed >= initialText.length;
  const showIcon = /foundry/i.test(done ? text : initialText.slice(0, typed));

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!shown || typed >= initialText.length) return;
    const t = setTimeout(() => setTyped((n) => n + 1), 90);
    return () => clearTimeout(t);
  }, [shown, typed, initialText.length]);

  return (
    <div className="bg-primary text-primary-foreground fixed inset-0 overflow-hidden">
      <InteractiveDotField tone="signal" className="absolute inset-0" gap={12} radius={64} />

      <div className="absolute inset-0 z-10">
        <AnimatedSignalGlyph
          seed="foundry-pulse"
          rows={48}
          cols={96}
          fontSize={15}
          fill
          className="size-full opacity-35"
        />
      </div>

      <div className="absolute inset-0 z-20 flex items-center justify-center">
        <div
          className={cn(
            "flex items-center gap-5 transition-all duration-1000 ease-out",
            shown ? "scale-100 opacity-100 blur-0" : "scale-95 opacity-0 blur-sm",
          )}
        >
          {showIcon ? (
            <span className="flex size-16 items-center justify-center bg-[#faf9f5] p-2 md:size-20">
              <FoundryMarkIcon className="size-full" />
            </span>
          ) : null}
          <span className="font-mono text-5xl font-medium tracking-[0.2em] whitespace-pre uppercase md:text-6xl">
            {done ? (
              <span
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onInput={(e) => setText(e.currentTarget.textContent ?? "")}
                className="outline-none"
              >
                {initialText}
              </span>
            ) : (
              <>
                {initialText.slice(0, typed)}
                <span className="animate-pulse">▌</span>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
