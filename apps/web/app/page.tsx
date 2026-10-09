import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Stage } from "@foundry/domain";
import { AnimatedSignalGlyph } from "@/components/animated-signal-glyph";
import { FoundryMark } from "@/components/foundry-mark";
import { InteractiveDotField } from "@/components/interactive-dot-field";
import { STAGE_THEME } from "@/lib/stage-theme";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/session";
import { resolveViewportHomePath } from "@/server/workspace-home";

const PHASES: { stage: Stage; label: string; blurb: string; code: string }[] = [
  {
    stage: "IDEATE",
    label: "Ideate",
    blurb: "A prompt becomes a brief and the questions still open.",
    code: "01",
  },
  {
    stage: "ENGINEER",
    label: "Engineer",
    blurb: "Schematic, PCB, CAD, firmware, and the bill of materials.",
    code: "02",
  },
  {
    stage: "VERIFY",
    label: "Verify",
    blurb: "Every requirement stays tied to a check that can prove it.",
    code: "03",
  },
  {
    stage: "LAUNCH",
    label: "Launch",
    blurb: "Pin a release, publish the docs, and open the storefront.",
    code: "04",
  },
];

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user)
    redirect(
      await resolveViewportHomePath(user.id, (await cookies()).get("foundry-last-project")?.value),
    );

  return (
    <main className="relative flex min-h-screen flex-col">
      <InteractiveDotField className="fixed inset-0" gap={18} radius={48} />

      <header className="relative z-10 flex items-center justify-between px-6 py-4 sm:px-8 lg:px-10">
        <FoundryMark />
        <div className="flex items-center gap-1">
          <Link
            href="/auth/sign-up"
            className="text-muted-foreground hover:text-foreground hidden px-3 py-2 text-[13px] transition-colors sm:inline"
          >
            Create account
          </Link>
          <Link
            href="/auth/sign-in"
            className="bg-foreground text-background hover:bg-foreground/90 px-3.5 py-2 text-[13px] font-medium transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      <div className="relative z-10 grid min-h-0 flex-1 lg:grid-cols-2">
        <section className="flex flex-col justify-center px-6 py-12 sm:px-8 lg:px-10 lg:py-14">
          <p className="text-muted-foreground font-mono text-[11px] tracking-[0.18em] uppercase">
            Hardware OS
          </p>
          <h1 className="mt-4 max-w-xl text-[clamp(2.5rem,4.6vw,4rem)] leading-[0.96] font-medium tracking-[-0.045em]">
            Describe it.
            <br />
            Engineer it.
            <br />
            Build it.
            <br />
            Sell it.
          </h1>
          <p className="text-muted-foreground mt-6 max-w-md text-[16px] leading-relaxed">
            One workspace for a physical product — from the sentence, through the circuit and the
            geometry, to a release you can stand behind.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/auth/sign-in"
              className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2.5 text-[14px] font-medium transition-colors"
            >
              Enter workspace
            </Link>
            <Link
              href="/auth/sign-up"
              className="border-border bg-card/80 hover:border-foreground/25 border px-4 py-2.5 text-[14px] font-medium backdrop-blur-sm transition-colors"
            >
              Create account
            </Link>
          </div>

          <ul className="mt-12 grid max-w-xl grid-cols-1 gap-x-8 gap-y-5 border-t pt-6 sm:grid-cols-2">
            {PHASES.map((phase) => {
              const theme = STAGE_THEME[phase.stage];
              return (
                <li key={phase.stage}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em]">
                      {phase.code}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[11px] font-medium tracking-[0.12em] uppercase",
                        theme.text,
                      )}
                    >
                      {phase.label}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1.5 text-[13px] leading-relaxed">
                    {phase.blurb}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        <SignalHero />
      </div>
    </main>
  );
}

/** Orange signal panel with cursor-reactive dots and the living ASCII mark. */
function SignalHero() {
  return (
    <section className="bg-primary text-primary-foreground relative min-h-[22rem] overflow-hidden lg:min-h-full">
      <InteractiveDotField tone="signal" gap={11} radius={64} />
      <div className="relative z-10 flex h-full min-h-[22rem] items-center justify-center p-6 lg:absolute lg:inset-0 lg:min-h-0">
        <AnimatedSignalGlyph
          seed="foundry-pulse"
          rows={36}
          cols={50}
          fontSize={18}
          className="opacity-95"
        />
      </div>
    </section>
  );
}
