import { describe, expect, it } from "vitest";
import type { CircuitDoc } from "@/lib/circuit/catalog";
import { Simulator } from "@/lib/sim/engine";
import { runSketch } from "@/lib/sim/sketch";
import { isRunnablePath, sketchSourceFor, translateArduino } from "@/lib/sim/arduino";

const BLINK = `
// Blink an LED on pin 13.
#include <Arduino.h>
#define LED_PIN 13
const int PERIOD = 500;
int counter;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(PERIOD);
  digitalWrite(LED_PIN, LOW);
  delay(PERIOD);
  counter = counter + 1;
  Serial.println("blink");
}
`;

function blinkCircuit(): CircuitDoc {
  return {
    version: 2,
    groups: [],
    parts: [
      { id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
      { id: "led", type: "wokwi-led", label: "D1", x: 200, y: 0 },
    ],
    wires: [
      { id: "w1", from: { part: "uno", pin: "13" }, to: { part: "led", pin: "A" } },
      { id: "w2", from: { part: "led", pin: "C" }, to: { part: "uno", pin: "GND.1" } },
    ],
  };
}

describe("translateArduino", () => {
  it("rewrites setup/loop as generators and yields delays", () => {
    const result = translateArduino(BLINK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toContain("function* setup()");
    expect(result.source).toContain("function* loop()");
    expect(result.source).toContain("yield delay(PERIOD)");
    expect(result.source).toContain("const LED_PIN = 13;");
    expect(result.source).toContain("let counter = 0;");
    expect(result.source).toContain('print("blink")');
    expect(result.source).not.toContain("Serial.begin");
    expect(result.source).not.toContain("#include");
  });

  it("runs the translated firmware against the schematic", () => {
    const translated = translateArduino(BLINK);
    expect(translated.ok).toBe(true);
    if (!translated.ok) return;

    const sim = new Simulator(blinkCircuit());
    const handle = runSketch(sim, "uno", translated.source);
    handle.advance(0);
    sim.step();
    expect(handle.error).toBeNull();

    handle.advance(1_000);
    expect(sim.step().outputs.get("led")).toBe(1);
    handle.advance(600_000);
    expect(sim.step().outputs.get("led")).toBe(0);
    handle.advance(1_100_000);
    expect(handle.logs).toContain("blink");
  });

  it("delegates calls to user functions so their delays still yield", () => {
    const result = translateArduino(`
void beep(int pin) {
  digitalWrite(pin, HIGH);
  delay(10);
  digitalWrite(pin, LOW);
}

void loop() {
  beep(8);
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toContain("function* beep(pin)");
    expect(result.source).toContain("yield* beep(8)");
  });

  it("refuses constructs it cannot translate honestly", () => {
    const result = translateArduino("class Motor { public: void spin(); };\nvoid loop() {}\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("class");
  });

  it("warns about libraries the simulator does not model", () => {
    const result = translateArduino(`
#include <Wire.h>
void setup() { Wire.begin(); }
void loop() {}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toContain("Wire");
  });

  it("keeps string literals and drops comments containing code", () => {
    const result = translateArduino(`
void loop() {
  // delay(999);
  print("delay(1) not a call");
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).not.toContain("999");
    expect(result.source).toContain('"delay(1) not a call"');
  });

  it("passes JavaScript sketches through untouched", () => {
    const js = "function* loop() { yield delay(1); }";
    expect(sketchSourceFor("sim/sketch.js", js)).toEqual({
      source: js,
      warnings: [],
      errors: [],
    });
    expect(isRunnablePath("src/main.cpp")).toBe(true);
    expect(isRunnablePath("README.md")).toBe(false);
  });
});
