import { describe, expect, it } from "vitest";
import { evaluateFit, pickFirmware, type FitInput } from "@/lib/integration/fit-check";
import { normalizeCircuitDoc } from "@/lib/circuit/catalog";

const BLINK = `#include <Arduino.h>

const int LED_PIN = 13;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
  delay(500);
}
`;

/** Uno + LED + resistor to ground, the smallest thing that can actually work. */
const blinkCircuit = (ledPin: string) =>
  normalizeCircuitDoc({
    version: 2,
    parts: [
      { id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
      { id: "led", type: "wokwi-led", label: "LED1", x: 200, y: 0 },
      { id: "r1", type: "wokwi-resistor", label: "R1", x: 300, y: 0, attrs: { value: "220" } },
    ],
    wires: [
      { id: "w1", from: { part: "uno", pin: ledPin }, to: { part: "led", pin: "A" } },
      { id: "w2", from: { part: "led", pin: "C" }, to: { part: "r1", pin: "1" } },
      { id: "w3", from: { part: "r1", pin: "2" }, to: { part: "uno", pin: "GND.1" } },
    ],
  });

const input = (over: Partial<FitInput> = {}): FitInput => ({
  circuit: blinkCircuit("13"),
  pcb: null,
  codeFiles: [{ path: "src/main.cpp", content: BLINK }],
  components: [{ name: "Arduino Uno", discipline: "ELECTRONICS" }],
  cad: [],
  requirements: [],
  validationChecks: [],
  ...over,
});

describe("pickFirmware", () => {
  it("prefers main.cpp over other firmware and over a sketch", () => {
    const picked = pickFirmware([
      { path: "sim/sketch.js", content: "" },
      { path: "src/util.cpp", content: "" },
      { path: "src/main.cpp", content: BLINK },
    ]);
    expect(picked?.path).toBe("src/main.cpp");
  });

  it("falls back to a JavaScript sketch when there is no firmware", () => {
    expect(pickFirmware([{ path: "sim/sketch.js", content: "" }])?.path).toBe("sim/sketch.js");
  });
});

describe("evaluateFit", () => {
  it("runs the firmware against the schematic and sees the LED light", () => {
    const report = evaluateFit(input());
    expect(report.simulation.ran).toBe(true);
    if (!report.simulation.ran) return;
    expect(report.simulation.label).toBe("SIMULATED");
    expect(report.simulation.firmwarePath).toBe("src/main.cpp");
    expect(report.simulation.pinsExercised).toContain("13");
    expect(report.simulation.actuators).toContainEqual({
      partId: "led",
      label: "LED1",
      activated: true,
    });
    expect(report.simulation.error).toBeNull();
  });

  it("catches firmware driving a pin the schematic never wires", () => {
    // The LED moved to pin 9; the firmware still blinks 13.
    const report = evaluateFit(input({ circuit: blinkCircuit("9") }));
    const message = report.findings.map((f) => f.message).join(" ");
    expect(message).toContain("pin 13");
    expect(report.counts.errors).toBeGreaterThan(0);
    expect(report.ok).toBe(false);
  });

  it("reports an LED that never activates", () => {
    const dark = `void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, LOW); delay(100); }\n`;
    const report = evaluateFit(input({ codeFiles: [{ path: "src/main.cpp", content: dark }] }));
    expect(report.findings.map((f) => f.message).join(" ")).toContain("never activated");
  });

  it("refuses to run firmware it cannot translate, rather than guessing", () => {
    const unsupported = `#include <Servo.h>\nServo s;\nclass Thing {};\nvoid setup() {}\nvoid loop() {}\n`;
    const report = evaluateFit(
      input({ codeFiles: [{ path: "src/main.cpp", content: unsupported }] }),
    );
    expect(report.simulation.ran).toBe(false);
    if (report.simulation.ran) return;
    expect(report.simulation.reason).toContain("src/main.cpp");
    expect(report.counts.errors).toBeGreaterThan(0);
  });

  it("flags parts with no simulation internals", () => {
    const withSensor = normalizeCircuitDoc({
      version: 2,
      parts: [
        { id: "uno", type: "wokwi-arduino-uno", x: 0, y: 0 },
        { id: "s1", type: "acme-hall-sensor", label: "Hall", x: 100, y: 0 },
      ],
      wires: [{ id: "w1", from: { part: "uno", pin: "2" }, to: { part: "s1", pin: "OUT" } }],
    });
    const report = evaluateFit(input({ circuit: withSensor }));
    expect(report.findings.map((f) => f.message).join(" ")).toContain("acme-hall-sensor");
  });

  it("flags CAD parts that no assembly puts together", () => {
    const report = evaluateFit(
      input({ cad: [{ path: "parts/case.kcl", name: "case", kind: "part" }] }),
    );
    const mechanical = report.findings.filter((f) => f.domain === "MECHANICAL");
    expect(mechanical.map((f) => f.message).join(" ")).toContain("no assembly");
  });

  it("cannot check anything without a schematic", () => {
    const report = evaluateFit(input({ circuit: null }));
    expect(report.ok).toBe(false);
    expect(report.simulation.ran).toBe(false);
  });
});
