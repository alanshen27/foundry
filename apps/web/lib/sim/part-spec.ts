/**
 * Behavioural models for parts the built-in catalog does not cover.
 *
 * `lib/sim/parts.ts` hand-codes a model per part type, which works for the
 * handful of Wokwi primitives but leaves every imported or AI-authored
 * schematic inert: the parts render and wire up, and the simulation has nothing
 * to say about them, so firmware written against them cannot be exercised.
 *
 * A spec closes that gap without executing model-authored code. It is data —
 * pins, drives, shorts, an output rule — that compiles into the same `PartModel`
 * the built-ins use. The vocabulary is deliberately small: what a part asserts
 * on a pin, which pins it joins, what a user can toggle, and what it displays.
 * Anything needing real analogue behaviour is out of scope and stays honest by
 * being absent rather than approximated.
 */

import type { Drive } from "@/lib/sim/net";
import type { PartContext, PartModel, PartState } from "@/lib/sim/parts";

/** When a rule applies. Conditions read the resolved state of another pin. */
export type SpecCondition = {
  when: "always" | "toggled" | "not-toggled" | "pin";
  /**
   * Pin the condition tests, for `when: "pin"`. Named apart from the rule's own
   * pin so a rule can drive one pin based on another.
   */
  whenPin?: string;
  is?: "high" | "low" | "floating";
};

export type SpecDrive = SpecCondition & { pin: string; drive: Drive };

export type SpecShort = SpecCondition & { pins: string[] };

export type PartSpec = {
  /** Human label for the simulation panel. */
  label: string;
  /**
   * Pin names, which MUST match the schematic's wire endpoints — a model whose
   * pins drift from the symbol is wired to nothing and silently does nothing.
   */
  pins: string[];
  /** MCU boards are driven by firmware rather than by their own rules. */
  mcu?: boolean;
  /** Makes the part clickable in the canvas. */
  interactive?: "momentary" | "latching";
  /** What the part asserts, before nets resolve. */
  drives?: SpecDrive[];
  /** Pins joined together — a switch merges nets rather than driving them. */
  shorts?: SpecShort[];
  /** Lights up when `high` reads high and `low` reads low (LED semantics). */
  indicator?: { high: string; low: string };
  /** Fixed reading returned by analogRead on the net this pin sits on. */
  analog?: { pin: string; value: number };
  /** Free-text note shown in the UI, e.g. what the real part does that this omits. */
  note?: string;
};

/** Specs authored per part type, stored on the circuit document. */
export type PartSpecMap = Record<string, PartSpec>;

const isToggled = (state: PartState) => Boolean(state.pressed ?? state.position ?? state.on);

function conditionHolds(condition: SpecCondition, ctx: PartContext): boolean {
  switch (condition.when) {
    case "always":
      return true;
    case "toggled":
      return isToggled(ctx.state);
    case "not-toggled":
      return !isToggled(ctx.state);
    case "pin": {
      // An incomplete condition is not a licence to fire the rule.
      if (!condition.whenPin || !condition.is) return false;
      const level = ctx.net(condition.whenPin).level;
      if (condition.is === "floating") return level === null;
      return level === (condition.is === "high" ? 1 : 0);
    }
  }
}

/** Compiles one spec into the model shape the engine already consumes. */
export function compilePartSpec(spec: PartSpec): PartModel {
  const pins = [...new Set(spec.pins.filter((p) => typeof p === "string" && p.length > 0))];
  const drives = spec.drives ?? [];
  const shorts = spec.shorts ?? [];

  const model: PartModel = {
    pins,
    label: spec.label,
    ...(spec.interactive ? { interactive: spec.interactive } : {}),
    ...(spec.interactive
      ? { initial: spec.interactive === "latching" ? { position: 0 } : { pressed: false } }
      : {}),
  };

  if (drives.length > 0 && !spec.mcu) {
    model.drive = (ctx, pin) => {
      // Last matching rule wins, so a spec can state a default and override it.
      let asserted: Drive = "float";
      for (const rule of drives) {
        if (rule.pin !== pin) continue;
        if (conditionHolds(rule, ctx)) asserted = rule.drive;
      }
      return asserted;
    };
  }

  if (shorts.length > 0) {
    model.shorts = (ctx) =>
      shorts.filter((rule) => conditionHolds(rule, ctx)).map((rule) => rule.pins);
  }

  if (spec.indicator) {
    const { high, low } = spec.indicator;
    model.output = (ctx) => (ctx.net(high).level === 1 && ctx.net(low).level === 0 ? 1 : 0);
  } else if (spec.interactive) {
    model.output = (ctx) => (isToggled(ctx.state) ? 1 : 0);
  }

  return model;
}

/** Whether a spec looks structurally usable; the UI reports the reasons. */
export function validatePartSpec(spec: PartSpec): string[] {
  const problems: string[] = [];
  if (!spec.label?.trim()) problems.push("missing label");
  if (!Array.isArray(spec.pins) || spec.pins.length === 0) problems.push("no pins");
  const pins = new Set(spec.pins ?? []);
  const unknown = (pin: string, where: string) => {
    if (!pins.has(pin)) problems.push(`${where} references unknown pin "${pin}"`);
  };
  const checkCondition = (rule: SpecCondition, where: string) => {
    if (rule.when !== "pin") return;
    if (!rule.whenPin || !rule.is)
      problems.push(`${where} condition needs both a whenPin and a level`);
    else unknown(rule.whenPin, `${where} condition`);
  };
  for (const rule of spec.drives ?? []) {
    unknown(rule.pin, "drive");
    checkCondition(rule, "drive");
  }
  for (const rule of spec.shorts ?? []) {
    for (const pin of rule.pins) unknown(pin, "short");
    if (rule.pins.length < 2) problems.push("a short needs at least two pins");
    checkCondition(rule, "short");
  }
  if (spec.indicator) {
    unknown(spec.indicator.high, "indicator");
    unknown(spec.indicator.low, "indicator");
  }
  if (spec.analog) unknown(spec.analog.pin, "analog source");
  return problems;
}

/**
 * A stand-in for a part with no model at all: its pins exist, so wires resolve
 * and the rest of the circuit behaves, but it asserts nothing. Labelled
 * UNMODELLED so nobody reads its silence as a result.
 */
export function inertModel(label: string, pins: string[]): PartModel {
  return { pins, label: `${label} (UNMODELLED)` };
}
