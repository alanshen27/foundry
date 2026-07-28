import { describe, expect, it } from "vitest";
import type { CircuitDoc } from "@/lib/circuit/catalog";
import { resolveNet } from "@/lib/sim/net";
import { Simulator, pinKey } from "@/lib/sim/engine";
import { runSketch } from "@/lib/sim/sketch";

function circuit(parts: CircuitDoc["parts"], wires: CircuitDoc["wires"]): CircuitDoc {
  return { version: 2, parts, wires, groups: [] };
}

/** Uno pin 13 -> LED anode, LED cathode -> GND. The hello world of Arduino. */
function blinkCircuit(): CircuitDoc {
  return circuit(
    [
      { id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
      { id: "led", type: "wokwi-led", label: "D1", x: 200, y: 0 },
    ],
    [
      { id: "w1", from: { part: "uno", pin: "13" }, to: { part: "led", pin: "A" } },
      { id: "w2", from: { part: "led", pin: "C" }, to: { part: "uno", pin: "GND.1" } },
    ],
  );
}

/** Button between pin 2 and GND, with pin 2 pulled up — the standard input. */
function buttonCircuit(): CircuitDoc {
  return circuit(
    [
      { id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
      { id: "btn", type: "wokwi-pushbutton", label: "SW1", x: 200, y: 0 },
    ],
    [
      { id: "w1", from: { part: "uno", pin: "2" }, to: { part: "btn", pin: "1.l" } },
      { id: "w2", from: { part: "btn", pin: "2.l" }, to: { part: "uno", pin: "GND.1" } },
    ],
  );
}

describe("resolveNet", () => {
  it("leaves an undriven net floating", () => {
    expect(resolveNet([])).toEqual({ level: null, conflict: false });
    expect(resolveNet(["float", "float"])).toEqual({ level: null, conflict: false });
  });

  it("lets a strong drive beat a pull-up", () => {
    expect(resolveNet(["pullup", "low"])).toEqual({ level: 0, conflict: false });
    expect(resolveNet(["low", "pullup"])).toEqual({ level: 0, conflict: false });
  });

  it("holds a pull-up when nothing stronger drives", () => {
    expect(resolveNet(["pullup", "float"])).toEqual({ level: 1, conflict: false });
  });

  it("reports two opposing strong drivers as contention", () => {
    expect(resolveNet(["high", "low"])).toMatchObject({ conflict: true });
  });

  it("does not call agreeing strong drivers a conflict", () => {
    expect(resolveNet(["high", "high"])).toEqual({ level: 1, conflict: false });
  });

  it("treats a pull-up against a pull-down as a divider, not a fault", () => {
    // Weak against weak is a resistor divider in reality — odd, but not a short.
    expect(resolveNet(["pullup", "pulldown"]).conflict).toBe(false);
  });
});

describe("engine — passive circuits", () => {
  it("lights an LED driven high against ground", () => {
    const sim = new Simulator(blinkCircuit());
    sim.setMcuDrive("uno", "13", "high");
    const snap = sim.step();
    expect(snap.outputs.get("led")).toBe(1);
  });

  it("leaves the LED dark when the pin is low", () => {
    const sim = new Simulator(blinkCircuit());
    sim.setMcuDrive("uno", "13", "low");
    expect(sim.step().outputs.get("led")).toBe(0);
  });

  it("leaves the LED dark when the pin floats", () => {
    const sim = new Simulator(blinkCircuit());
    expect(sim.step().outputs.get("led")).toBe(0);
  });

  it("keeps a reverse-biased LED dark", () => {
    // Anode to GND, cathode to the driven pin: wired backwards on purpose.
    const doc = circuit(
      [
        { id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
        { id: "led", type: "wokwi-led", label: "D1", x: 200, y: 0 },
      ],
      [
        { id: "w1", from: { part: "uno", pin: "13" }, to: { part: "led", pin: "C" } },
        { id: "w2", from: { part: "led", pin: "A" }, to: { part: "uno", pin: "GND.1" } },
      ],
    );
    const sim = new Simulator(doc);
    sim.setMcuDrive("uno", "13", "high");
    expect(sim.step().outputs.get("led")).toBe(0);
  });

  it("powers a rail from the board's own 5V pin", () => {
    const doc = circuit(
      [
        { id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
        { id: "led", type: "wokwi-led", label: "D1", x: 200, y: 0 },
      ],
      [
        { id: "w1", from: { part: "uno", pin: "5V" }, to: { part: "led", pin: "A" } },
        { id: "w2", from: { part: "led", pin: "C" }, to: { part: "uno", pin: "GND.1" } },
      ],
    );
    expect(new Simulator(doc).step().outputs.get("led")).toBe(1);
  });
});

describe("engine — switches merge nets", () => {
  it("reads high through a pull-up while the button is open", () => {
    const sim = new Simulator(buttonCircuit());
    sim.setMcuDrive("uno", "2", "pullup");
    expect(sim.step().pins.get(pinKey("uno", "2"))?.level).toBe(1);
  });

  it("pulls the input low when the button is pressed", () => {
    const sim = new Simulator(buttonCircuit());
    sim.setMcuDrive("uno", "2", "pullup");
    sim.setPartState("btn", { pressed: true });
    // Pressing shorts the input net to GND, and a strong low beats the pull-up.
    expect(sim.step().pins.get(pinKey("uno", "2"))?.level).toBe(0);
  });

  it("releases back to high", () => {
    const sim = new Simulator(buttonCircuit());
    sim.setMcuDrive("uno", "2", "pullup");
    sim.setPartState("btn", { pressed: true });
    sim.step();
    sim.setPartState("btn", { pressed: false });
    expect(sim.step().pins.get(pinKey("uno", "2"))?.level).toBe(1);
  });

  it("routes a slide switch to the selected throw", () => {
    const doc = circuit(
      [
        { id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
        { id: "sw", type: "wokwi-slide-switch", label: "SW1", x: 200, y: 0 },
      ],
      [
        { id: "w1", from: { part: "uno", pin: "5V" }, to: { part: "sw", pin: "1" } },
        { id: "w2", from: { part: "sw", pin: "2" }, to: { part: "uno", pin: "7" } },
        { id: "w3", from: { part: "sw", pin: "3" }, to: { part: "uno", pin: "GND.1" } },
      ],
    );
    const sim = new Simulator(doc);
    sim.setPartState("sw", { position: 0 });
    expect(sim.step().pins.get(pinKey("uno", "7"))?.level).toBe(1);
    sim.setPartState("sw", { position: 1 });
    expect(sim.step().pins.get(pinKey("uno", "7"))?.level).toBe(0);
  });

  it("passes a level through a resistor", () => {
    const doc = circuit(
      [
        { id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
        { id: "r", type: "wokwi-resistor", label: "R1", x: 100, y: 0 },
        { id: "led", type: "wokwi-led", label: "D1", x: 200, y: 0 },
      ],
      [
        { id: "w1", from: { part: "uno", pin: "9" }, to: { part: "r", pin: "1" } },
        { id: "w2", from: { part: "r", pin: "2" }, to: { part: "led", pin: "A" } },
        { id: "w3", from: { part: "led", pin: "C" }, to: { part: "uno", pin: "GND.1" } },
      ],
    );
    const sim = new Simulator(doc);
    sim.setMcuDrive("uno", "9", "high");
    expect(sim.step().outputs.get("led")).toBe(1);
  });
});

describe("engine — faults", () => {
  it("reports contention when a pin fights the ground rail", () => {
    const doc = circuit(
      [{ id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 }],
      [{ id: "w1", from: { part: "uno", pin: "4" }, to: { part: "uno", pin: "GND.1" } }],
    );
    const sim = new Simulator(doc);
    sim.setMcuDrive("uno", "4", "high");
    expect(sim.step().conflicts).toBeGreaterThan(0);
  });

  it("stays clean when nothing fights", () => {
    const sim = new Simulator(blinkCircuit());
    sim.setMcuDrive("uno", "13", "high");
    expect(sim.step().conflicts).toBe(0);
  });
});

describe("sketch runtime", () => {
  it("drives a pin from setup", () => {
    const sim = new Simulator(blinkCircuit());
    const sketch = runSketch(
      sim,
      "uno",
      `
      function setup() { pinMode(13, OUTPUT); digitalWrite(13, HIGH); }
    `,
    );
    sketch.advance(1000);
    expect(sketch.error).toBeNull();
    expect(sim.step().outputs.get("led")).toBe(1);
  });

  it("blinks on the virtual clock", () => {
    const sim = new Simulator(blinkCircuit());
    const sketch = runSketch(
      sim,
      "uno",
      `
      function setup() { pinMode(13, OUTPUT); }
      function* loop() {
        digitalWrite(13, HIGH);
        yield delay(500);
        digitalWrite(13, LOW);
        yield delay(500);
      }
    `,
    );

    sketch.advance(1_000); // 1 ms in: the LED is on
    expect(sim.step().outputs.get("led")).toBe(1);

    sketch.advance(600_000); // 600 ms: past the first delay, now off
    expect(sim.step().outputs.get("led")).toBe(0);

    sketch.advance(1_100_000); // 1.1 s: back on for the next cycle
    expect(sim.step().outputs.get("led")).toBe(1);
  });

  it("advances millis with the virtual clock", () => {
    const sim = new Simulator(blinkCircuit());
    const sketch = runSketch(
      sim,
      "uno",
      `
      function* loop() { yield delay(100); print(millis()); }
    `,
    );
    sketch.advance(350_000);
    expect(sketch.logs.length).toBeGreaterThan(0);
    expect(Number(sketch.logs[0])).toBeGreaterThanOrEqual(100);
  });

  it("reads a button through INPUT_PULLUP", () => {
    const sim = new Simulator(buttonCircuit());
    const sketch = runSketch(
      sim,
      "uno",
      `
      function setup() { pinMode(2, INPUT_PULLUP); }
      function* loop() { print(digitalRead(2)); yield delay(10); }
    `,
    );

    sketch.advance(5_000);
    sim.step();
    sketch.advance(15_000);
    expect(sketch.logs.at(-1)).toBe("1");

    sim.setPartState("btn", { pressed: true });
    sim.step();
    sketch.advance(40_000);
    expect(sketch.logs.at(-1)).toBe("0");
  });

  it("does not report a phantom press on the first loop", () => {
    // setup() configures the pull-up, so the circuit must settle between setup
    // and the first loop() — otherwise pin 2 still reads floating, which is LOW,
    // and the sketch sees a press that never happened.
    const sim = new Simulator(buttonCircuit());
    const sketch = runSketch(
      sim,
      "uno",
      `
      function setup() { pinMode(2, INPUT_PULLUP); }
      function* loop() { print(digitalRead(2)); yield delay(10); }
    `,
    );

    sketch.advance(0); // setup only
    sim.step(); // settle the pull-up into a level
    sketch.advance(15_000);

    expect(sketch.logs[0]).toBe("1");
  });

  it("reads a potentiometer with analogRead", () => {
    const doc = circuit(
      [
        { id: "uno", type: "wokwi-arduino-uno", label: "U1", x: 0, y: 0 },
        { id: "pot", type: "wokwi-potentiometer", label: "POT1", x: 200, y: 0 },
      ],
      [{ id: "w1", from: { part: "pot", pin: "SIG" }, to: { part: "uno", pin: "A0" } }],
    );
    const sim = new Simulator(doc);
    sim.setPartState("pot", { value: 750 });
    const sketch = runSketch(
      sim,
      "uno",
      `
      function* loop() { print(analogRead(A0_PIN)); yield delay(10); }
      const A0_PIN = "A0";
    `,
    );
    sketch.advance(30_000);
    expect(sketch.logs.at(-1)).toBe("750");
  });

  it("surfaces a syntax error instead of throwing", () => {
    const sim = new Simulator(blinkCircuit());
    const sketch = runSketch(sim, "uno", `function setup( {{{`);
    expect(sketch.error).toBeTruthy();
  });

  it("surfaces a runtime error instead of throwing", () => {
    const sim = new Simulator(blinkCircuit());
    const sketch = runSketch(sim, "uno", `function setup() { nope(); }`);
    sketch.advance(1000);
    expect(sketch.error).toContain("nope");
  });

  it("does not spin forever on a loop with no delay", () => {
    const sim = new Simulator(blinkCircuit());
    const sketch = runSketch(
      sim,
      "uno",
      `
      function setup() { pinMode(13, OUTPUT); }
      function loop() { digitalWrite(13, HIGH); }
    `,
    );
    // A non-generator loop is charged a tick per call, so this terminates.
    sketch.advance(10_000);
    expect(sketch.error).toBeNull();
    expect(sketch.now()).toBeGreaterThan(0);
  });
});
