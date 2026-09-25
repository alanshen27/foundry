/**
 * The compact environmental monitor from the project proposal, as graph input.
 *
 * A battery, a microcontroller, an I2C sensor, a status LED and a resistor;
 * firmware that drives two pins; three CAD parts in one assembly; three
 * requirements and two validation checks. It is small enough to reason about
 * completely and wide enough that the edges cross every domain — which is what
 * makes it a fair test of impact analysis rather than a demo of it.
 *
 * `EXPECTED_IMPACT` below is the point of this file. See the comment there.
 */

import type { CircuitDoc } from "@/lib/circuit/catalog";
import type { GraphInput } from "@/lib/graph/derive";
import type { FitSimulation } from "@/lib/integration/fit-check";

export const circuit: CircuitDoc = {
  version: 2,
  groups: [],
  parts: [
    { id: "u1", type: "wokwi-arduino-nano", label: "U1", x: 0, y: 0 },
    { id: "u2", type: "wokwi-bme680", label: "U2", x: 200, y: 0 },
    { id: "d1", type: "wokwi-led", label: "D1", x: 100, y: 120 },
    { id: "r1", type: "wokwi-resistor", label: "R1", x: 60, y: 120 },
    { id: "bt1", type: "wokwi-battery", label: "BT1", x: 0, y: 220 },
  ],
  wires: [
    { id: "w1", from: { part: "u1", pin: "D2" }, to: { part: "r1", pin: "1" }, label: "LED_CTRL" },
    { id: "w2", from: { part: "r1", pin: "2" }, to: { part: "d1", pin: "A" }, label: "LED_A" },
    { id: "w3", from: { part: "d1", pin: "C" }, to: { part: "u1", pin: "GND" }, label: "GND" },
    { id: "w4", from: { part: "u1", pin: "5V" }, to: { part: "u2", pin: "VCC" }, label: "VCC" },
    { id: "w5", from: { part: "u2", pin: "SDA" }, to: { part: "u1", pin: "A4" }, label: "I2C_SDA" },
    { id: "w6", from: { part: "bt1", pin: "+" }, to: { part: "u1", pin: "VIN" }, label: "VBAT" },
    { id: "w7", from: { part: "bt1", pin: "-" }, to: { part: "u1", pin: "GND" }, label: "GND" },
  ],
};

/**
 * Stands in for a real simulator run so the fixture stays pure. These are the
 * pins the firmware would exercise: the LED control line and the I2C data line.
 */
export const simulation: FitSimulation = {
  ran: true,
  label: "SIMULATED",
  mcuLabel: "U1",
  firmwarePath: "src/main.cpp",
  virtualMs: 3000,
  pinsExercised: ["D2", "A4"],
  actuators: [{ partId: "d1", label: "D1", activated: true }],
  conflicts: 0,
  unstable: false,
  logs: [],
  error: null,
};

export const envMonitorInput: GraphInput = {
  circuit,
  pcb: null,
  simulation,
  codeFiles: [
    { id: "file-main", path: "src/main.cpp", content: "// sampling loop\n" },
    { id: "file-power", path: "src/power.cpp", content: "// sleep + battery gauge\n" },
  ],
  components: [
    {
      id: "cmp-battery",
      refDes: "BT1",
      name: "Battery, LiPo 2000 mAh",
      discipline: "ELECTRONICS",
      capacityMah: 2000,
    },
    {
      id: "cmp-mcu",
      refDes: "U1",
      name: "Arduino Nano controller",
      discipline: "ELECTRONICS",
      currentDrawMa: 19,
    },
    {
      id: "cmp-sensor",
      refDes: "U2",
      name: "BME680 environmental sensor",
      discipline: "ELECTRONICS",
      currentDrawMa: 4,
    },
    {
      id: "cmp-led",
      refDes: "D1",
      name: "Status LED indicator",
      discipline: "ELECTRONICS",
      currentDrawMa: 8,
    },
    { id: "cmp-resistor", refDes: "R1", name: "220R resistor", discipline: "ELECTRONICS" },
  ],
  cad: [
    { path: "parts/enclosure.kcl", name: "enclosure", kind: "part", content: "// shell\n" },
    { path: "parts/battery-bay.kcl", name: "battery bay", kind: "part", content: "// bay\n" },
    { path: "parts/sensor-window.kcl", name: "sensor window", kind: "part", content: "// vent\n" },
    {
      path: "assembly/product.kcl",
      name: "product",
      kind: "assembly",
      content: [
        'import "parts/enclosure.kcl" as enclosure',
        'import "parts/battery-bay.kcl" as battery_bay',
        'import "parts/sensor-window.kcl" as sensor_window',
      ].join("\n"),
    },
  ],
  requirements: [
    {
      id: "req-runtime",
      title: "Operating time of at least 8 hours per charge",
      priority: "MUST",
      minValue: 8,
      unit: "h",
      verificationMethod: "Battery life bench test",
    },
    {
      id: "req-mass",
      title: "Total mass under 120 g",
      priority: "SHOULD",
      maxValue: 120,
      unit: "g",
    },
    {
      id: "req-sample",
      title: "Reports temperature at least once per minute",
      priority: "MUST",
    },
  ],
  validationChecks: [
    { id: "chk-battery", title: "Battery life bench test", targetPath: "BT1" },
    { id: "chk-fit", title: "Enclosure fit inspection", targetPath: "parts/enclosure.kcl" },
  ],
};

/**
 * The edges no deriver can produce, because each is a design decision rather
 * than a fact recoverable from the data: the battery is the part chosen to
 * meet the runtime and mass budgets, and src/power.cpp is the code written to
 * deliver that runtime. In the product these come from a person or from the
 * copilot's link_nodes, with a rationale attached.
 */
export const authoredEdges = [
  {
    from: "component:cmp-battery",
    to: "requirement:req-runtime",
    kind: "SATISFIES" as const,
    origin: "USER" as const,
    confidence: 1,
    evidence: "Cell capacity is what the runtime budget is drawn against",
  },
  {
    from: "component:cmp-battery",
    to: "requirement:req-mass",
    kind: "SATISFIES" as const,
    origin: "USER" as const,
    confidence: 1,
    evidence: "The cell is the single heaviest item in the build",
  },
  {
    from: "requirement:req-runtime",
    to: "codefile:file-power",
    kind: "IMPLEMENTED_BY" as const,
    origin: "AGENT" as const,
    confidence: 1,
    evidence: "Sleep scheduling and the fuel gauge live here",
  },
];

/**
 * HAND-CONSTRUCTED. Read this before changing anything below.
 *
 * These lists were written by a person reading the product above and asking
 * "if I changed this, what would I have to look at again?" — not by running
 * the deriver and recording what came out. That distinction is the entire
 * value of the file: a expectation generated from the implementation tests
 * that the implementation equals itself, which is no test at all. If a change
 * makes one of these fail, the honest options are to fix the traversal or to
 * argue on the merits that the product reasoning here was wrong. Regenerating
 * the list is not one of them.
 *
 * The proposal commits to NO FALSE NEGATIVES against a set like this, so the
 * assertion is containment: extra results are tolerable, misses are not.
 */
export const EXPECTED_IMPACT: Record<string, string[]> = {
  // Swap the cell. Everything it feeds is in question, the bay that holds it
  // and the assembly that bay sits in, the bench test that measures it, both
  // budgets it was chosen against, the power firmware written to hit the
  // runtime, and — through the MCU it powers, that chip's nets and the pins on
  // them — the firmware driving those pins.
  "component:cmp-battery": [
    "component:cmp-mcu",
    "component:cmp-sensor",
    "component:cmp-led",
    "cadpart:parts/battery-bay.kcl",
    "cadassembly:assembly/product.kcl",
    "check:chk-battery",
    "requirement:req-runtime",
    "requirement:req-mass",
    "codefile:file-power",
    "codefile:file-main",
  ],
  // Swap the microcontroller. Its schematic part, the nets it terminates, the
  // signal pins on those nets, and the firmware that drives them.
  "component:cmp-mcu": [
    "circuitpart:u1",
    "net:LED_CTRL",
    "net:I2C_SDA",
    "pin:u1:D2",
    "pin:u1:A4",
    "codefile:file-main",
  ],
};

/**
 * Things a person would say are NOT affected, per root.
 *
 * This is the precision half, and it is the assertion that actually has teeth:
 * a traversal that returned every node in the project would satisfy the
 * containment check above and fail here.
 */
export const EXPECTED_UNAFFECTED: Record<string, string[]> = {
  "component:cmp-battery": [
    // Nothing ties the cell to the outer shell or the check that inspects it.
    "cadpart:parts/enclosure.kcl",
    "check:chk-fit",
    // How often the device samples is independent of what powers it.
    "requirement:req-sample",
    // The LED's series resistor has no stated draw, so it is not a known load.
    "component:cmp-resistor",
    "circuitpart:r1",
  ],
  "component:cmp-mcu": [
    "component:cmp-battery",
    "requirement:req-runtime",
    "cadpart:parts/enclosure.kcl",
    "check:chk-fit",
  ],
};
