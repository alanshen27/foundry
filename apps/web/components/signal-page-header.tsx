import type { ReactNode } from "react";
import { AnimatedSignalGlyph } from "@/components/animated-signal-glyph";
import { MatrixScreen } from "@/components/matrix-cover";
import { cn } from "@/lib/utils";

/**
 * Solid orange page banner: dot screen, eyebrow code, mono title,
 * animated ASCII field on the right.
 */
export function SignalPageHeader({
  code,
  title,
  subtitle,
  glyphSeed,
  className,
}: {
  code: string;
  title: string;
  subtitle?: ReactNode;
  glyphSeed: string;
  className?: string;
}) {
  return (
    <div className={cn("bg-primary text-primary-foreground relative overflow-hidden", className)}>
      <MatrixScreen color="#faf9f5" opacity={0.25} />
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 opacity-80">
        <AnimatedSignalGlyph seed={glyphSeed} rows={10} cols={30} fontSize={9} />
      </div>
      <div className="relative px-5 py-5">
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase opacity-80">{code}</p>
        <h1 className="mt-1 font-mono text-[28px] font-medium tracking-[-0.04em]">{title}</h1>
        {subtitle ? <p className="mt-1.5 max-w-xl text-[14px] opacity-85">{subtitle}</p> : null}
      </div>
    </div>
  );
}
