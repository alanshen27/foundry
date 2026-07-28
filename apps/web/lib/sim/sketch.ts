/**
 * The code component: a sketch driving the simulated circuit.
 *
 * This is not an AVR emulator. Running real Arduino firmware means compiling
 * `.ino` to `.hex` with avr-gcc and stepping it through avr8js, which needs a
 * server-side toolchain. What runs here is JavaScript with the Arduino API's
 * shape, so the wiring, the logic and the pin semantics are all exercised, but
 * timing is virtual and nothing is cycle-accurate. Results must be labelled
 * SIMULATED, per the PRD's rule about local adapters.
 *
 * `delay` is a yield rather than a wait. A sketch is a generator:
 *
 *     function* loop() {
 *       digitalWrite(13, HIGH);
 *       yield delay(500);
 *       digitalWrite(13, LOW);
 *       yield delay(500);
 *     }
 *
 * That buys determinism — the engine advances a virtual clock by exactly the
 * requested amount, so a run is reproducible and can be stepped, which real
 * timers would not give. The cost is that `delay` must be yielded; a sketch
 * that loops forever without yielding cannot be preempted (see runSketch).
 */

import type { Simulator } from "@/lib/sim/engine";
import type { Drive } from "@/lib/sim/net";

export const HIGH = 1;
export const LOW = 0;
export const INPUT = 0;
export const OUTPUT = 1;
export const INPUT_PULLUP = 2;

/** A yielded delay request, in virtual microseconds. */
export type Yielded = { delayUs: number };

export type SketchApi = {
  pinMode: (pin: number | string, mode: number) => void;
  digitalWrite: (pin: number | string, value: number) => void;
  digitalRead: (pin: number | string) => number;
  analogRead: (pin: number | string) => number;
  analogWrite: (pin: number | string, value: number) => void;
  delay: (ms: number) => Yielded;
  delayMicroseconds: (us: number) => Yielded;
  millis: () => number;
  micros: () => number;
  print: (...args: unknown[]) => void;
  HIGH: number;
  LOW: number;
  INPUT: number;
  OUTPUT: number;
  INPUT_PULLUP: number;
};

export type SketchHandle = {
  /** Advance the sketch until it asks to wait, or the budget is spent. */
  advance: (untilUs: number) => void;
  logs: string[];
  error: string | null;
  /** Virtual clock in microseconds. */
  now: () => number;
};

type Compiled = {
  setup?: () => void | Generator<Yielded, void, unknown>;
  loop?: () => void | Generator<Yielded, void, unknown>;
};

/**
 * Compiles sketch source into setup/loop. Uses `new Function`, so the sketch
 * runs with the page's privileges — acceptable because it is the user's own
 * code, but it is the reason a Worker is the right next step: a non-yielding
 * infinite loop here freezes the tab and cannot be interrupted.
 */
function compile(source: string, api: SketchApi): Compiled {
  const names = Object.keys(api);
  const values = names.map((n) => api[n as keyof SketchApi]);
  const factory = new Function(
    ...names,
    `"use strict";
${source}
return {
  setup: typeof setup === "function" ? setup : undefined,
  loop: typeof loop === "function" ? loop : undefined,
};`,
  );
  return factory(...values) as Compiled;
}

const isGenerator = (v: unknown): v is Generator<Yielded, void, unknown> =>
  typeof v === "object" && v !== null && typeof (v as Generator).next === "function";

/** Maps an Arduino pin argument onto the MCU part's pin name. */
function pinName(pin: number | string): string {
  return typeof pin === "number" ? String(pin) : pin;
}

/**
 * Wires a sketch to a simulator. `mcuPartId` is the board whose pins the
 * sketch drives — the schematic can hold more than one.
 */
export function runSketch(sim: Simulator, mcuPartId: string, source: string): SketchHandle {
  let clockUs = 0;
  const logs: string[] = [];
  let error: string | null = null;
  /** Pin directions, so digitalRead on an OUTPUT pin reads what we drive. */
  const modes = new Map<string, number>();

  const setDrive = (pin: string, drive: Drive | null) => sim.setMcuDrive(mcuPartId, pin, drive);

  const api: SketchApi = {
    HIGH,
    LOW,
    INPUT,
    OUTPUT,
    INPUT_PULLUP,
    pinMode: (pin, mode) => {
      const name = pinName(pin);
      modes.set(name, mode);
      // An input stops driving; a pull-up input asserts a weak high.
      if (mode === OUTPUT) setDrive(name, "low");
      else if (mode === INPUT_PULLUP) setDrive(name, "pullup");
      else setDrive(name, "float");
    },
    digitalWrite: (pin, value) => {
      const name = pinName(pin);
      // Writing to a pin still configured as input sets the pull-up, which is
      // the real Arduino behaviour and a common source of confusion.
      if (modes.get(name) === OUTPUT) setDrive(name, value ? "high" : "low");
      else setDrive(name, value ? "pullup" : "float");
    },
    digitalRead: (pin) => (sim.pinState(mcuPartId, pinName(pin)).level === 1 ? HIGH : LOW),
    analogRead: (pin) => sim.analogAt(mcuPartId, pinName(pin)),
    analogWrite: (pin, value) => {
      // No PWM modelling: anything above mid-scale reads as driven high.
      setDrive(pinName(pin), value > 127 ? "high" : "low");
    },
    delay: (ms) => ({ delayUs: Math.max(0, ms) * 1000 }),
    delayMicroseconds: (us) => ({ delayUs: Math.max(0, us) }),
    millis: () => Math.floor(clockUs / 1000),
    micros: () => clockUs,
    print: (...args) => {
      logs.push(args.map((a) => String(a)).join(" "));
      if (logs.length > 200) logs.shift();
    },
  };

  let program: Compiled = {};
  try {
    program = compile(source, api);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  let started = false;
  let active: Generator<Yielded, void, unknown> | null = null;
  /** Virtual time the current generator is blocked until. */
  let blockedUntil = 0;

  const beginSetup = () => {
    if (!program.setup) return;
    const result = program.setup();
    if (isGenerator(result)) active = result;
  };

  const advance = (untilUs: number) => {
    if (error) return;
    try {
      if (!started) {
        started = true;
        beginSetup();
      }

      // Bounded so one call cannot spin forever on a fast loop.
      for (let guard = 0; guard < 10_000 && clockUs < untilUs; guard++) {
        if (active) {
          if (clockUs < blockedUntil) {
            clockUs = Math.min(untilUs, blockedUntil);
            continue;
          }
          const { value, done } = active.next();
          if (done) {
            active = null;
            continue;
          }
          blockedUntil = clockUs + (value?.delayUs ?? 0);
          continue;
        }

        if (!program.loop) {
          clockUs = untilUs;
          return;
        }
        const result = program.loop();
        if (isGenerator(result)) active = result;
        else {
          // A non-generator loop() has no yield points, so charge it a tick to
          // keep the virtual clock moving instead of spinning.
          clockUs += 1000;
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  };

  // `error` is a getter: a plain property would capture the value at return
  // time, so an error thrown later during advance() would never be visible.
  return {
    advance,
    logs,
    now: () => clockUs,
    get error() {
      return error;
    },
  };
}
