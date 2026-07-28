"use client";

import Link from "next/link";
import { redirect } from "next/navigation";
import type { Stage } from "@foundry/domain";
import { FoundryMark } from "@/components/foundry-mark";
import { InteractiveDotField } from "@/components/interactive-dot-field";
import { SignalGlyph } from "@/components/signal-glyph";
import { STAGE_THEME } from "@/lib/stage-theme";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/session";
import { resolveWorkspaceHomePath } from "@/server/workspace-home";

const PHASES: { stage: Stage; verb: string; label: string; blurb: string; code: string }[] = [
  {
    stage: "IDEATE",
    verb: "Describe it.",
    label: "Ideate",
    blurb: "A prompt becomes a brief, requirements, and open questions.",
    code: "01",
  },
  {
    stage: "ENGINEER",
    verb: "Engineer it.",
    label: "Engineer",
    blurb: "Schematic, PCB, CAD, firmware, and BOM in one workspace.",
    code: "02",
  },
  {
    stage: "VERIFY",
    verb: "Build it.",
    label: "Verify",
    blurb: "Every requirement tracked against a check that proves it.",
    code: "03",
  },
  {
    stage: "LAUNCH",
    verb: "Sell it.",
    label: "Launch",
    blurb: "Pin a release, publish the docs, open the storefront.",
    code: "04",
  },
];

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect(await resolveWorkspaceHomePath(user.id));

  return (
    <main className="relative flex min-h-screen flex-col">
      <InteractiveDotField className="fixed inset-0" gap={16} radius={56} />

      <header className="border-border relative z-10 flex items-center justify-between border-b bg-background/80 px-6 py-4 backdrop-blur-sm sm:px-10">
        <FoundryMark />
        <Link
          href="/auth/sign-in"
          className="bg-foreground text-background hover:bg-foreground/90 px-4 py-2 font-mono text-[12px] tracking-[0.08em] uppercase transition-colors"
        >
          Sign in
        </Link>
      </header>

      <div className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 lg:grid-cols-12">
        <SignalHero />

        <section className="border-border bg-background/70 flex flex-col justify-between px-6 py-12 backdrop-blur-[2px] sm:px-10 lg:col-span-7 lg:border-l lg:px-12 lg:py-16">
          <div>
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.16em] uppercase">
              Hardware OS
            </p>
            <h1 className="mt-4 font-mono text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.1] font-medium tracking-[-0.04em]">
              {PHASES.map((phase) => (
                <span key={phase.stage} className="mr-2 inline-block whitespace-nowrap">
                  {phase.verb}
                </span>
              ))}
            </h1>
            <p className="text-muted-foreground mt-5 max-w-xl text-[15px] leading-relaxed">
              An AI-native workspace that carries one physical product from a sentence to a
              manufacturable release — without losing the thread between requirements, circuits,
              geometry, and firmware.
            </p>
          </div>

          <ul className="mt-12 grid gap-0 border-t sm:grid-cols-2">
            {PHASES.map((phase, i) => {
              const theme = STAGE_THEME[phase.stage];
              return (
                <li
                  key={phase.stage}
                  className={cn(
                    "border-border bg-card flex flex-col gap-3 border-b p-5 transition-colors",
                    i % 2 === 0 && "sm:border-r",
                    theme.cardHover,
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em]">
                      {phase.code}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[12px] font-medium tracking-[0.08em] uppercase",
                        theme.text,
                      )}
                    >
                      {phase.label}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-[13px] leading-relaxed">{phase.blurb}</p>
                </li>
              );
            })}
          </ul>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/auth/sign-in"
              className="bg-primary text-primary-foreground hover:bg-primary/90 px-5 py-2.5 font-mono text-[12px] tracking-[0.1em] uppercase transition-colors"
            >
              Enter workspace
            </Link>
            <Link
              href="/auth/sign-up"
              className="border-border bg-card hover:border-foreground/30 border px-5 py-2.5 font-mono text-[12px] tracking-[0.1em] uppercase transition-colors"
            >
              Create account
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

/** Orange signal panel — client island so the cursor field can run on it. */
function SignalHero() {
  return (
    <section className="bg-primary text-primary-foreground relative flex min-h-[32rem] flex-col overflow-hidden px-6 py-8 sm:px-8 lg:col-span-5 lg:min-h-0 lg:px-8 lg:py-10">
      <InteractiveDotField tone="signal" gap={10} radius={60} />
      <div className="relative z-10 flex items-center gap-2 font-mono text-[12px] tracking-[0.16em] uppercase">
        <span className="inline-grid grid-cols-3 gap-[2px]">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="size-[3px] bg-[#faf9f5]" />
          ))}
        </span>
        Foundyr
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center py-6">
        <SignalGlyph
          seed="foundyr-pulse"
          rows={28}
          cols={40}
          className="max-w-full text-[#faf9f5]"
          monoClassName="text-[clamp(9px,1.5vw,13px)] leading-[1.05] tracking-[0.14em]"
        />
      </div>

      <p className="relative z-10 max-w-xs font-mono text-[11px] leading-relaxed tracking-[0.02em] opacity-90">
        When form dissolves, the center holds.
        <br />A silent pulse from sentence to ship.
      </p>
    </section>
  );
}
