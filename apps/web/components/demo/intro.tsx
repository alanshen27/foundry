"use client";

import { useEffect, useRef, useState } from "react";
import { FoundryMarkIcon } from "@/components/foundry-mark";
import { cn } from "@/lib/utils";

const GLYPHS = "▓▒░#@%&$+=/\\|<>[]{}◤◢◣◥■□▪▫01";

/**
 * Video-opener title card on signal orange: the wordmark decodes through
 * scrambling glyph characters, logo mark inline to its left. The text is
 * editable — click it and type, or pass ?text=Your+Words.
 */
export function DemoIntro({ initialText = "Foundry" }: { initialText?: string }) {
  const [shown, setShown] = useState(false);
  const [display, setDisplay] = useState("");
  const [settled, setSettled] = useState(false);
  const targetRef = useRef(initialText);
  const spanRef = useRef<HTMLSpanElement | null>(null);

  // Glyph decode: each character cycles random glyphs, locking in
  // left-to-right until the full word resolves.
  useEffect(() => {
    const t0 = setTimeout(() => setShown(true), 400);
    let frame = 0;
    const timer = setInterval(() => {
      const target = targetRef.current;
      frame += 1;
      const locked = Math.floor((frame - 8) / 3);
      if (locked >= target.length) {
        setDisplay(target);
        setSettled(true);
        clearInterval(timer);
        return;
      }
      setDisplay(
        target
          .split("")
          .map((ch, i) =>
            i < locked || ch === " " ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
          )
          .join(""),
      );
    }, 50);
    return () => {
      clearTimeout(t0);
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#ff5a00]">
      <div className="absolute inset-0 z-10 flex items-center justify-center">
        <div
          className={cn(
            "flex items-center gap-6 transition-all duration-1000 ease-out",
            shown ? "scale-100 opacity-100 blur-0" : "scale-95 opacity-0 blur-sm",
          )}
        >
          <span className="flex size-16 items-center justify-center rounded-none bg-white p-2.5 md:size-20">
            <FoundryMarkIcon className="size-full" />
          </span>
          <span
            ref={spanRef}
            contentEditable={settled}
            suppressContentEditableWarning
            spellCheck={false}
            onInput={() => {
              targetRef.current = spanRef.current?.textContent ?? "";
            }}
            className="font-mono text-5xl font-semibold tracking-[0.18em] whitespace-pre text-white uppercase outline-none md:text-6xl"
          >
            {display}
          </span>
        </div>
      </div>
    </div>
  );
}
