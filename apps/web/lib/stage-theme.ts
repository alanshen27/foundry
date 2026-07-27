import type { Stage } from "@foundry/domain";

/**
 * Pipeline identity colors, one hue per stage (tokens live in globals.css).
 *
 * Class strings are written out in full rather than composed, because Tailwind
 * only emits classes it can read literally in the source — `bg-phase-${x}/10`
 * would compile to nothing.
 */
export type StageTheme = {
  /** Nav icon at rest; the label stays muted so only the glyph carries hue. */
  idleIcon: string;
  /** Selected nav item: tinted pill. */
  active: string;
  /** Accent rail on the selected nav item. */
  rail: string;
  /** Icon tile on stage cards. */
  tile: string;
  /** Card border on hover. */
  cardHover: string;
  /** Bare foreground tint, for headings and inline text. */
  text: string;
};

export const STAGE_THEME: Record<Stage, StageTheme> = {
  IDEATE: {
    idleIcon: "text-phase-ideate/70 group-hover:text-phase-ideate",
    active: "bg-phase-ideate/10 text-phase-ideate",
    rail: "bg-phase-ideate",
    tile: "bg-phase-ideate/10 text-phase-ideate",
    cardHover: "hover:border-phase-ideate/45",
    text: "text-phase-ideate",
  },
  ENGINEER: {
    idleIcon: "text-phase-engineer/70 group-hover:text-phase-engineer",
    active: "bg-phase-engineer/10 text-phase-engineer",
    rail: "bg-phase-engineer",
    tile: "bg-phase-engineer/10 text-phase-engineer",
    cardHover: "hover:border-phase-engineer/45",
    text: "text-phase-engineer",
  },
  VERIFY: {
    idleIcon: "text-phase-verify/70 group-hover:text-phase-verify",
    active: "bg-phase-verify/10 text-phase-verify",
    rail: "bg-phase-verify",
    tile: "bg-phase-verify/10 text-phase-verify",
    cardHover: "hover:border-phase-verify/45",
    text: "text-phase-verify",
  },
  LAUNCH: {
    idleIcon: "text-phase-launch/70 group-hover:text-phase-launch",
    active: "bg-phase-launch/10 text-phase-launch",
    rail: "bg-phase-launch",
    tile: "bg-phase-launch/10 text-phase-launch",
    cardHover: "hover:border-phase-launch/45",
    text: "text-phase-launch",
  },
};
