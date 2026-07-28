/**
 * Net resolution — the core of the circuit simulator.
 *
 * A pin is not an input or an output. An MCU pin's direction is decided at
 * runtime by firmware, a button shorts two pins together and drives nothing,
 * and I2C works precisely because everyone pulls low and nobody drives high.
 * So the unit of state is the *net* (from lib/pcb/netlist.ts), and every part
 * touching a net proposes a drive strength rather than a value.
 *
 * The net takes the strongest proposal. Two opposing strong drivers is
 * contention: a real electrical fault, and the simulation counterpart of the
 * copper short that DRC reports — so it is surfaced, never silently resolved.
 */

/** Ordered weakest to strongest; the order is what makes resolution work. */
export type Drive = "float" | "pulldown" | "pullup" | "low" | "high";

const STRENGTH: Record<Drive, number> = {
  float: 0,
  pulldown: 1,
  pullup: 1,
  low: 2,
  high: 2,
};

/** Logic level a drive asserts, or null when it asserts nothing. */
function levelOf(d: Drive): 0 | 1 | null {
  switch (d) {
    case "high":
    case "pullup":
      return 1;
    case "low":
    case "pulldown":
      return 0;
    default:
      return null;
  }
}

export type NetState = {
  /** Resolved logic level, or null when the net is left floating. */
  level: 0 | 1 | null;
  /** Two drivers of equal strength disagree — a short in the making. */
  conflict: boolean;
};

export const FLOATING: NetState = { level: null, conflict: false };

/**
 * Resolves every drive on one net. Strongest wins; equal strength that
 * disagrees is contention, reported with the level left at the disputed value
 * so the UI can still show something rather than blanking the net.
 */
export function resolveNet(drives: Drive[]): NetState {
  let best = 0;
  let level: 0 | 1 | null = null;
  let conflict = false;

  for (const d of drives) {
    const strength = STRENGTH[d];
    if (strength === 0) continue;
    const value = levelOf(d);
    if (value === null) continue;

    if (strength > best) {
      best = strength;
      level = value;
      conflict = false;
    } else if (strength === best && value !== level) {
      // A pull-up and pull-down on the same net is a divider, not a fault;
      // only equal *strong* drivers are a genuine short.
      conflict = strength >= STRENGTH.low;
    }
  }

  return { level, conflict };
}

/** Convenience for the common "is this net high" question. */
export const isHigh = (s: NetState) => s.level === 1;
