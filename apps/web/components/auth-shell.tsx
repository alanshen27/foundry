"use client";

import type { ReactNode } from "react";
import { AnimatedSignalGlyph } from "@/components/animated-signal-glyph";
import { InteractiveDotField } from "@/components/interactive-dot-field";

/** Shared Nothing/matrix chrome for auth + invite surfaces. */
export function AuthShell({
  title,
  subtitle,
  children,
  glyphSeed,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  glyphSeed: string;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <InteractiveDotField className="fixed inset-0" gap={18} radius={48} />
      <div className="border-border bg-card relative z-10 w-full max-w-md border shadow-[var(--shadow-panel)]">
        <div className="bg-primary text-[#faf9f5] relative h-48 overflow-hidden">
          <InteractiveDotField tone="signal" gap={9} radius={44} />
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatedSignalGlyph seed={glyphSeed} rows={18} cols={52} fontSize={8} />
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
