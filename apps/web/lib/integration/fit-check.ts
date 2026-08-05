/**
 * The step that asks whether the project actually fits together.
 *
 * Every stage of FOUNDRY validates itself: ERC checks the schematic, DRC checks
 * the board, the CAD engine checks each part. Nothing checked the seams — a
 * schematic can be clean while the firmware drives a pin nothing is wired to, a
 * BOM can be complete while half of it never appears on the board, and an
 * assembly can execute while no part in it matches the enclosure the PCB needs.
 * Those are the failures that reach a user, and they are all cross-stage.
 *
 * This module is that seam check. It is deliberately data-in / findings-out: no
 * database, no network, no rendering, so the same evaluation runs from the
 * copilot's tool, from the Verify panel, and from tests.
 *
 * Results are `SIMULATED` in the PRD's sense — a behavioural run of a
 * translated sketch, not compiled firmware on real silicon — and are labelled
 * so nobody mistakes them for verification.
 */

import type { CircuitDoc } from "@/lib/circuit/catalog";
import { runCircuitErc } from "@/lib/circuit/erc";
import type { PcbSet } from "@/lib/pcb/doc";
import { buildNets, buildRatsnest } from "@/lib/pcb/netlist";
import { sketchSourceFor, isFirmwarePath } from "@/lib/sim/arduino";
import { Simulator } from "@/lib/sim/engine";
import { buildModelIndex, findMcuPart } from "@/lib/sim/models";
import { runSketch } from "@/lib/sim/sketch";
import type { Drive } from "@/lib/sim/net";

export type FitDomain = "ELECTRICAL" | "SOFTWARE" | "MECHANICAL" | "CROSS_DOMAIN";
export type FitSeverity = "error" | "warning" | "info";

export type FitFinding = {
  domain: FitDomain;
  severity: FitSeverity;
  message: string;
  /** What to do about it, when the fix is not obvious from the message. */
  hint?: string;
};

/** Outcome of exercising the firmware against the schematic. */
export type FitSimulation =
  | {
      ran: true;
      /** Always SIMULATED: behavioural model, not compiled firmware. */
      label: "SIMULATED";
      mcuLabel: string;
      firmwarePath: string;
      /** Virtual milliseconds of program time executed. */
      virtualMs: number;
      /** MCU pins the firmware read or drove. */
      pinsExercised: string[];
      /** Parts with a visible output, and whether they ever turned on. */
      actuators: { partId: string; label: string; activated: boolean }[];
      conflicts: number;
      unstable: boolean;
      logs: string[];
      error: string | null;
    }
  | { ran: false; reason: string };

export type FitReport = {
  /** No error-severity findings and, when firmware exists, a clean run. */
  ok: boolean;
  findings: FitFinding[];
  simulation: FitSimulation;
  counts: { errors: number; warnings: number };
};

export type FitInput = {
  circuit: CircuitDoc | null;
  pcb: PcbSet | null;
  /** Code files with contents; the firmware is picked from them. */
  codeFiles: { path: string; content: string }[];
  /** BOM entries from Engineer > Sourcing. */
  components: { name: string; discipline: string; refDes?: string | null }[];
  /** CAD components (parts, assembly, docs). */
  cad: { path: string; name: string; kind: string }[];
  requirements: { title: string; priority: string }[];
  validationChecks: { title: string }[];
};

/** Virtual time the smoke run covers. Long enough for a 1 Hz blink to toggle. */
const RUN_MS = 3_000;
const STEP_MS = 10;

/**
 * The file the simulation runs. Firmware wins over a hand-written sketch: the
 * point of the check is to exercise what ships.
 */
export function pickFirmware(
  files: { path: string; content: string }[],
): { path: string; content: string } | null {
  const firmware = files.filter((f) => isFirmwarePath(f.path));
  const main = firmware.find((f) => /(^|\/)main\.(cpp|ino)$/i.test(f.path));
  if (main) return main;
  if (firmware.length > 0) return firmware[0]!;
  const sketch = files.find((f) => /\.(js|mjs)$/i.test(f.path));
  return sketch ?? null;
}

/**
 * A simulator that records which MCU pins the firmware touched. Recording at
 * the boundary rather than parsing the source is what makes the answer exact:
 * a pin reached through a variable or a helper still shows up.
 */
class RecordingSimulator extends Simulator {
  readonly touched = new Set<string>();

  override setMcuDrive(partId: string, pin: string, drive: Drive | null) {
    this.touched.add(pin);
    super.setMcuDrive(partId, pin, drive);
  }

  override pinState(partId: string, pin: string) {
    this.touched.add(pin);
    return super.pinState(partId, pin);
  }

  override analogAt(partId: string, pin: string) {
    this.touched.add(pin);
    return super.analogAt(partId, pin);
  }
}

/** Runs the firmware against the schematic and reports what happened. */
function simulate(circuit: CircuitDoc, firmware: { path: string; content: string }): FitSimulation {
  const mcu = findMcuPart(circuit);
  if (!mcu) return { ran: false, reason: "The schematic has no microcontroller to run code on." };

  const translated = sketchSourceFor(firmware.path, firmware.content);
  if (translated.errors.length > 0) {
    return {
      ran: false,
      reason: `${firmware.path} cannot be simulated: ${translated.errors.join(" ")}`,
    };
  }

  const sim = new RecordingSimulator(circuit);
  const handle = runSketch(sim, mcu.id, translated.source);
  handle.advance(0);
  sim.step();

  const activated = new Set<string>();
  let conflicts = 0;
  let unstable = false;
  for (let ms = STEP_MS; ms <= RUN_MS; ms += STEP_MS) {
    handle.advance(ms * 1000);
    const snap = sim.step();
    for (const [partId, value] of snap.outputs) if (value > 0) activated.add(partId);
    conflicts = Math.max(conflicts, snap.conflicts);
    unstable = unstable || snap.unstable;
    if (handle.error) break;
  }

  const models = buildModelIndex(circuit);
  const actuators = circuit.parts
    .filter((part) => models.of(part.type).output && !models.isMcu(part.type))
    .map((part) => ({
      partId: part.id,
      label: part.label ?? part.id,
      activated: activated.has(part.id),
    }));

  return {
    ran: true,
    label: "SIMULATED",
    mcuLabel: mcu.label ?? mcu.id,
    firmwarePath: firmware.path,
    virtualMs: RUN_MS,
    pinsExercised: [...sim.touched].sort(),
    actuators,
    conflicts,
    unstable,
    logs: handle.logs.slice(-20),
    error: handle.error,
  };
}

/** MCU pins that carry a wire, so firmware pin use can be compared to them. */
function wiredMcuPins(circuit: CircuitDoc, mcuId: string): Set<string> {
  const pins = new Set<string>();
  for (const wire of circuit.wires) {
    if (wire.from.part === mcuId) pins.add(wire.from.pin);
    if (wire.to.part === mcuId) pins.add(wire.to.pin);
  }
  return pins;
}

const isPowerPin = (pin: string) =>
  pin.startsWith("GND") || pin === "5V" || pin === "3.3V" || pin === "VIN" || pin === "VCC";

function checkElectrical(circuit: CircuitDoc, findings: FitFinding[]) {
  for (const issue of runCircuitErc(circuit)) {
    findings.push({
      domain: "ELECTRICAL",
      severity: issue.severity,
      message: issue.message,
    });
  }

  const models = buildModelIndex(circuit);
  if (models.unmodelled.length > 0) {
    findings.push({
      domain: "ELECTRICAL",
      severity: "warning",
      message: `No simulation internals for ${models.unmodelled.join(", ")}.`,
      hint: "Generate a part spec for each type so the firmware can be exercised against it.",
    });
  }

  const nets = buildNets(circuit);
  const singleNodeNets = nets.filter((net) => net.nodes.length < 2);
  if (singleNodeNets.length > 0) {
    findings.push({
      domain: "ELECTRICAL",
      severity: "warning",
      message: `${singleNodeNets.length} net${singleNodeNets.length === 1 ? "" : "s"} connect only one pin.`,
    });
  }
}

function checkBoard(circuit: CircuitDoc, pcb: PcbSet | null, findings: FitFinding[]) {
  if (!pcb || pcb.boards.every((b) => b.footprints.length === 0)) {
    findings.push({
      domain: "ELECTRICAL",
      severity: "warning",
      message: "No PCB layout yet, so the schematic has nothing to be built as.",
    });
    return;
  }

  const placed = new Set<string>();
  for (const board of pcb.boards) {
    const ratsnest = buildRatsnest(circuit, board);
    for (const fp of board.footprints) if (fp.partId) placed.add(fp.partId);
    for (const dangling of ratsnest.issues.danglingFootprints) {
      findings.push({
        domain: "ELECTRICAL",
        severity: "error",
        message: `Footprint ${dangling.refDes} claims schematic part ${dangling.partId}, which no longer exists.`,
      });
    }
    for (const unmapped of ratsnest.issues.unmappedPins) {
      findings.push({
        domain: "ELECTRICAL",
        severity: "error",
        message: `${unmapped.refDes} has no pad for wired pin ${unmapped.pin}.`,
        hint: "Set pinMap on the footprint, or pick a footprint whose pads match the symbol.",
      });
    }
    if (ratsnest.airwires.length > 0) {
      findings.push({
        domain: "ELECTRICAL",
        severity: "warning",
        message: `${ratsnest.airwires.length} connection${ratsnest.airwires.length === 1 ? "" : "s"} on ${board.name ?? "the board"} are still unrouted.`,
      });
    }
  }

  const missing = circuit.parts.filter((part) => !placed.has(part.id));
  if (missing.length > 0) {
    findings.push({
      domain: "ELECTRICAL",
      severity: "warning",
      message: `${missing.length} schematic part${missing.length === 1 ? "" : "s"} have no footprint: ${missing
        .slice(0, 6)
        .map((p) => p.label ?? p.id)
        .join(", ")}${missing.length > 6 ? "…" : ""}.`,
    });
  }
}

function checkFirmware(
  circuit: CircuitDoc,
  simulation: FitSimulation,
  findings: FitFinding[],
): void {
  if (!simulation.ran) {
    findings.push({ domain: "SOFTWARE", severity: "error", message: simulation.reason });
    return;
  }

  if (simulation.error) {
    findings.push({
      domain: "SOFTWARE",
      severity: "error",
      message: `Firmware threw during simulation: ${simulation.error}`,
    });
  }

  const mcu = findMcuPart(circuit);
  if (mcu) {
    const wired = wiredMcuPins(circuit, mcu.id);
    const driven = simulation.pinsExercised.filter((pin) => !isPowerPin(pin));
    const unwired = driven.filter((pin) => !wired.has(pin));
    if (unwired.length > 0) {
      findings.push({
        domain: "CROSS_DOMAIN",
        severity: "error",
        message: `Firmware uses ${mcu.label ?? mcu.id} pin${unwired.length === 1 ? "" : "s"} ${unwired.join(", ")}, which nothing is wired to.`,
        hint: "Wire the pin on the schematic, or change the pin the firmware uses.",
      });
    }
    const idle = [...wired].filter((pin) => !isPowerPin(pin) && !driven.includes(pin));
    if (idle.length > 0) {
      findings.push({
        domain: "CROSS_DOMAIN",
        severity: "warning",
        message: `Wired pin${idle.length === 1 ? "" : "s"} ${idle.join(", ")} are never used by the firmware.`,
      });
    }
  }

  const dead = simulation.actuators.filter((a) => !a.activated);
  if (dead.length > 0) {
    findings.push({
      domain: "CROSS_DOMAIN",
      severity: "warning",
      message: `${dead.map((a) => a.label).join(", ")} never activated in ${simulation.virtualMs / 1000}s of simulated run.`,
      hint: "Either the firmware never drives it, or the part is wired the wrong way round.",
    });
  }

  if (simulation.conflicts > 0) {
    findings.push({
      domain: "ELECTRICAL",
      severity: "error",
      message: `${simulation.conflicts} net${simulation.conflicts === 1 ? "" : "s"} had two drivers fighting during the run.`,
    });
  }
  if (simulation.unstable) {
    findings.push({
      domain: "ELECTRICAL",
      severity: "warning",
      message: "The circuit never settled during the run — likely a feedback loop.",
    });
  }
}

function checkMechanical(input: FitInput, findings: FitFinding[]) {
  const parts = input.cad.filter((c) => c.kind === "part");
  const assembly = input.cad.find((c) => c.kind === "assembly");
  if (parts.length === 0) {
    findings.push({
      domain: "MECHANICAL",
      severity: "warning",
      message: "No CAD parts yet, so there is no enclosure for the electronics.",
    });
    return;
  }
  if (!assembly) {
    findings.push({
      domain: "MECHANICAL",
      severity: "error",
      message: `${parts.length} CAD parts exist but no assembly puts them together.`,
      hint: "Run add_part_to_assembly so assembly/product.kcl shows how the parts fit.",
    });
  }
}

function checkCoverage(input: FitInput, findings: FitFinding[]) {
  const electronics = input.components.filter((c) => c.discipline === "ELECTRONICS");
  const partCount = input.circuit?.parts.length ?? 0;
  if (electronics.length > 0 && partCount === 0) {
    findings.push({
      domain: "CROSS_DOMAIN",
      severity: "error",
      message: `The BOM lists ${electronics.length} electronic parts but the schematic is empty.`,
    });
  } else if (partCount > 0 && electronics.length === 0) {
    findings.push({
      domain: "CROSS_DOMAIN",
      severity: "warning",
      message: "The schematic has parts that appear nowhere in the BOM.",
    });
  }

  const musts = input.requirements.filter((r) => r.priority === "MUST");
  if (musts.length > 0 && input.validationChecks.length === 0) {
    findings.push({
      domain: "CROSS_DOMAIN",
      severity: "warning",
      message: `${musts.length} MUST requirements have no validation check.`,
    });
  }
}

/**
 * Evaluates whether the stages agree with each other, and whether the firmware
 * does anything when run against the schematic.
 */
export function evaluateFit(input: FitInput): FitReport {
  const findings: FitFinding[] = [];
  const circuit = input.circuit;

  if (!circuit || circuit.parts.length === 0) {
    findings.push({
      domain: "ELECTRICAL",
      severity: "error",
      message: "No schematic, so nothing can be checked against it.",
    });
    return {
      ok: false,
      findings,
      simulation: { ran: false, reason: "No schematic." },
      counts: { errors: 1, warnings: 0 },
    };
  }

  checkElectrical(circuit, findings);
  checkBoard(circuit, input.pcb, findings);

  const firmware = pickFirmware(input.codeFiles);
  const simulation = firmware
    ? simulate(circuit, firmware)
    : ({ ran: false, reason: "No firmware in the repository to run." } as const);
  checkFirmware(circuit, simulation, findings);

  checkMechanical(input, findings);
  checkCoverage(input, findings);

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  return { ok: errors === 0, findings, simulation, counts: { errors, warnings } };
}

/** Stable key for a finding, so the UI can list them without index keys. */
export const findingKey = (finding: FitFinding, index: number) =>
  `${finding.domain}:${index}:${finding.message.slice(0, 40)}`;
