import Link from "next/link";
import { redirect } from "next/navigation";
import { Cpu, Lightbulb, Rocket, ShieldCheck } from "lucide-react";
import type { Stage } from "@foundry/domain";
import { FoundryMark } from "@/components/foundry-mark";
import { STAGE_THEME } from "@/lib/stage-theme";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/session";
import { resolveWorkspaceHomePath } from "@/server/workspace-home";

const PHASES: { stage: Stage; verb: string; label: string; blurb: string; icon: typeof Lightbulb }[] =
  [
    {
      stage: "IDEATE",
      verb: "Describe it.",
      label: "Ideate",
      blurb: "A prompt becomes a brief, requirements, and open questions.",
      icon: Lightbulb,
    },
    {
      stage: "ENGINEER",
      verb: "Engineer it.",
      label: "Engineer",
      blurb: "Schematic, PCB, CAD, firmware, and BOM in one workspace.",
      icon: Cpu,
    },
    {
      stage: "VERIFY",
      verb: "Build it.",
      label: "Verify",
      blurb: "Every requirement tracked against a check that proves it.",
      icon: ShieldCheck,
    },
    {
      stage: "LAUNCH",
      verb: "Sell it.",
      label: "Launch",
      blurb: "Pin a release, publish the docs, open the storefront.",
      icon: Rocket,
    },
  ];

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect(await resolveWorkspaceHomePath(user.id));

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-8">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-phase-engineer/20 absolute -top-48 left-1/2 h-105 w-190 -translate-x-1/2 rounded-full blur-[130px]" />
        <div className="bg-phase-ideate/20 absolute -bottom-40 -left-40 h-100 w-140 rounded-full blur-[130px]" />
        <div className="bg-phase-launch/15 absolute -right-40 -bottom-48 h-100 w-140 rounded-full blur-[130px]" />
      </div>

      <div className="relative flex w-full max-w-4xl flex-col items-center gap-10">
        <FoundryMark className="scale-110" />

        <div className="flex flex-col items-center gap-5 text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {PHASES.map((phase) => (
              <span
                key={phase.stage}
                className={cn(
                  "mr-2.5 inline-block whitespace-nowrap",
                  STAGE_THEME[phase.stage].text,
                )}
              >
                {phase.verb}
              </span>
            ))}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-lg">
            An AI-native workspace that carries one physical product from a sentence to a
            manufacturable release — without losing the thread between requirements, circuits,
            geometry, and firmware.
          </p>
        </div>

        <ul className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PHASES.map((phase) => {
            const theme = STAGE_THEME[phase.stage];
            const Icon = phase.icon;
            return (
              <li
                key={phase.stage}
                className={cn(
                  "bg-card/70 flex flex-col gap-2.5 rounded-xl border p-4 backdrop-blur-sm transition-colors",
                  theme.cardHover,
                )}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg",
                    theme.tile,
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <div>
                  <p className="text-[13px] font-semibold">{phase.label}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                    {phase.blurb}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        <Link
          href="/auth/sign-in"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-6 py-2.5 text-sm font-medium shadow-sm transition-colors"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
