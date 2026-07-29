"use client";

import type { ReactNode } from "react";
import { AnimatedSignalGlyph } from "@/components/animated-signal-glyph";
import { InteractiveDotField } from "@/components/interactive-dot-field";
import { Card, CardContent } from "@/components/ui/card";

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
      <Card className="relative z-10 w-full max-w-md gap-0 py-0 shadow-[var(--shadow-panel)]">
        <div className="bg-primary relative h-48 overflow-hidden text-[#faf9f5]">
          <InteractiveDotField tone="signal" gap={9} radius={44} />
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatedSignalGlyph seed={glyphSeed} rows={18} cols={52} fontSize={8} />
          </div>
        </div>
        <CardContent className="px-5 py-6">
          <h1 className="font-mono text-xl font-medium tracking-[-0.03em]">{title}</h1>
          {subtitle ? <p className="text-muted-foreground mt-1 text-[13px]">{subtitle}</p> : null}
          {children}
        </CardContent>
      </Card>
    </main>
  );
}
