/**
 * Behavioural models for catalog parts.
 *
 * A model is deliberately tiny: given the resolved state of the nets it
 * touches, what does this part drive, and what does it look like? No part
 * knows about any other part — everything they say to each other goes through
 * a net, which is what makes the set composable and the engine simple.
 *
 * Pin names match @wokwi/elements exactly (an LED's "A"/"C", a pushbutton's
 * "1.l"/"2.l"), because those are the names the schematic's wires already
 * carry. A model whose pin names drift from the element silently stops being
 * connected to anything.
 */

import type { Drive, NetState } from "@/lib/sim/net";

/** Per-part mutable state: button pressed, latch position, and so on. */
export type PartState = Record<string, number | boolean>;

export type PartContext = {
  /** Resolved state of the net a pin sits on; floating when unwired. */
  net: (pin: string) => NetState;
  state: PartState;
};

export type PartModel = {
  /** Pins the part exposes, for wiring and for the engine's net mapping. */
  pins: string[];
  /** Human label for the simulation panel. */
  label: string;
  /** Whether a user can interact with it (press, toggle). */
  interactive?: "momentary" | "latching";
  initial?: PartState;
  /** What this part asserts on a pin, before the net resolves. */
  drive?: (ctx: PartContext, pin: string) => Drive;
  /**
   * Pins shorted together while a condition holds — a switch is not a driver,
   * it merges nets. Returned as groups of pin names.
   */
  shorts?: (ctx: PartContext) => string[][];
  /** Visual readout: 0..1 brightness, or a boolean on/off. */
  output?: (ctx: PartContext) => number;
};

const ARDUINO_DIGITAL = Array.from({ length: 14 }, (_, i) => String(i));
const ARDUINO_ANALOG = Array.from({ length: 6 }, (_, i) => `A${i}`);

/**
 * MCU boards expose pins but drive nothing on their own — the sketch runtime
 * drives them (see lib/sim/sketch.ts). Modelled here only so the engine knows
 * the pins exist and can map them onto nets.
 */
const MCU_PINS = [
  ...ARDUINO_DIGITAL,
  ...ARDUINO_ANALOG,
  "5V",
  "3.3V",
  "VIN",
  "GND.1",
  "GND.2",
  "GND.3",
];

export const PART_MODELS: Record<string, PartModel> = {
  "wokwi-arduino-uno": { pins: MCU_PINS, label: "Arduino Uno" },
  "wokwi-arduino-nano": { pins: MCU_PINS, label: "Arduino Nano" },
  "wokwi-arduino-mega": { pins: MCU_PINS, label: "Arduino Mega" },

  "wokwi-led": {
    pins: ["A", "C"],
    label: "LED",
    // Forward biased only: anode high, cathode low. Reverse bias stays dark,
    // which is the mistake worth showing rather than hiding.
    output: (ctx) => (ctx.net("A").level === 1 && ctx.net("C").level === 0 ? 1 : 0),
  },

  "wokwi-resistor": {
    pins: ["1", "2"],
    label: "Resistor",
    // Behaviourally a resistor passes a level through. This is the known lie:
    // two resistors in series should divide the voltage, and here they do not.
    shorts: () => [["1", "2"]],
  },

  "wokwi-pushbutton": {
    pins: ["1.l", "1.r", "2.l", "2.r"],
    label: "Pushbutton",
    interactive: "momentary",
    initial: { pressed: false },
    // The two sides are permanently joined internally; pressing bridges them.
    shorts: (ctx) =>
      ctx.state.pressed
        ? [["1.l", "1.r", "2.l", "2.r"]]
        : [
            ["1.l", "1.r"],
            ["2.l", "2.r"],
          ],
    output: (ctx) => (ctx.state.pressed ? 1 : 0),
  },

  "wokwi-pushbutton-6mm": {
    pins: ["1.l", "1.r", "2.l", "2.r"],
    label: "Pushbutton 6mm",
    interactive: "momentary",
    initial: { pressed: false },
    shorts: (ctx) =>
      ctx.state.pressed
        ? [["1.l", "1.r", "2.l", "2.r"]]
        : [
            ["1.l", "1.r"],
            ["2.l", "2.r"],
          ],
    output: (ctx) => (ctx.state.pressed ? 1 : 0),
  },

  "wokwi-slide-switch": {
    pins: ["1", "2", "3"],
    label: "Slide switch",
    interactive: "latching",
    initial: { position: 0 },
    // Common pin 2 connects to 1 or 3 depending on the slider.
    shorts: (ctx) => (ctx.state.position ? [["2", "3"]] : [["1", "2"]]),
    output: (ctx) => (ctx.state.position ? 1 : 0),
  },

  "wokwi-buzzer": {
    pins: ["1", "2"],
    label: "Buzzer",
    output: (ctx) => (ctx.net("1").level === 1 && ctx.net("2").level === 0 ? 1 : 0),
  },

  "wokwi-potentiometer": {
    pins: ["GND", "SIG", "VCC"],
    label: "Potentiometer",
    interactive: "latching",
    initial: { value: 512 },
    // The wiper is read by analogRead directly; see lib/sim/engine.ts.
  },
};

export function partModel(type: string): PartModel | undefined {
  return PART_MODELS[type];
}

/** Types the simulator understands; everything else is inert but still wired. */
export const SIMULATED_TYPES = Object.keys(PART_MODELS);

/** MCU boards are where a sketch's pins live. */
export const MCU_TYPES = new Set([
  "wokwi-arduino-uno",
  "wokwi-arduino-nano",
  "wokwi-arduino-mega",
]);
