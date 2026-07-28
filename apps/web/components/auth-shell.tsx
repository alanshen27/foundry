"use client";

import type { ReactNode } from "react";
import { AnimatedSignalGlyph } from "@/components/animated-signal-glyph";
import { FoundryMark } from "@/components/foundry-mark";
import { InteractiveDotField } from "@/components/interactive-dot-field";

/** Shared Nothing/matrix chrome for auth + invite surfaces. */
export function AuthShell({
  code,
  title,
  subtitle,
  children,
  glyphSeed,
}: {
  code: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  glyphSeed: string;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <InteractiveDotField className="fixed inset-0" gap={18} radius={48} />
      <div className="border-border bg-card relative z-10 w-full max-w-md border shadow-[var(--shadow-panel)]">
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <FoundryMark />
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
            {code}
          </span>
        </div>
        <div className="bg-primary text-[#faf9f5] relative h-28 overflow-hidden">
          <InteractiveDotField tone="signal" gap={9} radius={44} />
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatedSignalGlyph seed={glyphSeed} rows={12} cols={52} fontSize={7} />
          </div>
        </div>
        <div className="px-5 py-6">
          <h1 className="font-mono text-xl font-medium tracking-[-0.03em]">{title}</h1>
          {subtitle ? <p className="text-muted-foreground mt-1 text-[13px]">{subtitle}</p> : null}
          {children}
        </div>
      </div>
    </main>
  );
}
