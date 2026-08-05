/**
 * The simulation engine: schematic in, net states out.
 *
 * Two things make this more than a lookup table.
 *
 * Nets are not static. A switch or button does not drive anything — it *joins*
 * nets, so the topology changes as the user presses things. Every step
 * therefore re-merges the wire-derived nets through a union-find before
 * resolving, rather than treating the netlist as fixed.
 *
 * Drives can depend on levels. A part may read one net to decide what to drive
 * on another, so a single pass is not guaranteed to settle. The engine iterates
 * to a fixed point and gives up after a bounded number of rounds, reporting the
 * instability instead of hanging or silently returning a half-settled state.
 */

import type { CircuitDoc } from "@/lib/circuit/catalog";
import { buildNets } from "@/lib/pcb/netlist";
import { DisjointSet } from "@/lib/pcb/routing";
import { FLOATING, resolveNet, type Drive, type NetState } from "@/lib/sim/net";
import type { PartState } from "@/lib/sim/parts";
import { buildModelIndex, type ModelIndex } from "@/lib/sim/models";

/** Rounds allowed before the engine calls a circuit unstable (e.g. a ring oscillator). */
const MAX_ROUNDS = 12;

/**
 * Key for one pin. The separator is an explicit NUL escape, not a literal
 * control character: it cannot occur in a part id or pin name, so keys never
 * collide, but written invisibly it silently fails to match a hand-built
 * string. Callers use this function rather than composing keys themselves.
 */
export const pinKey = (partId: string, pin: string) => `${partId}\0${pin}`;

export type SimSnapshot = {
  /** Resolved state per pin key, for rendering and for the sketch's reads. */
  pins: Map<string, NetState>;
  /** Visual output per part id, 0..1 (LED brightness, buzzer on). */
  outputs: Map<string, number>;
  /** Nets where two strong drivers disagree. */
  conflicts: number;
  /** True when the circuit never settled — usually a feedback loop. */
  unstable: boolean;
};

export class Simulator {
  private circuit: CircuitDoc;
  /**
   * Model per part type: built-in, document-authored spec, or inert. Held on
   * the simulator rather than looked up globally so an imported schematic can
   * bring the internals its parts need.
   */
  private models: ModelIndex;
  /** Wire-derived net index per pin; isolated pins get their own. */
  private netOfPin = new Map<string, number>();
  /** Mutable per-part state (pressed, switch position, wiper). */
  readonly partState = new Map<string, PartState>();
  /** Drives asserted by the sketch on MCU pins. Use setMcuDrive to write. */
  private readonly mcuDrives = new Map<string, Drive>();
  private snapshot: SimSnapshot = {
    pins: new Map(),
    outputs: new Map(),
    conflicts: 0,
    unstable: false,
  };

  constructor(circuit: CircuitDoc) {
    this.circuit = circuit;
    this.models = buildModelIndex(circuit);
    this.rebuild();
  }

  /** Part types on this schematic that nothing knows how to simulate. */
  unmodelledTypes(): string[] {
    return this.models.unmodelled;
  }

  /** Recomputes the static net map. Call when the schematic itself changes. */
  rebuild() {
    this.models = buildModelIndex(this.circuit);
    this.netOfPin.clear();
    let next = 0;

    for (const net of buildNets(this.circuit)) {
      const index = next++;
      for (const node of net.nodes) this.netOfPin.set(pinKey(node.partId, node.pin), index);
    }

    // Every modelled pin needs a net even when nothing is wired to it, or a
    // switch could not merge it into anything.
    for (const part of this.circuit.parts) {
      const model = this.models.of(part.type);
      for (const pin of model.pins) {
        const key = pinKey(part.id, pin);
        if (!this.netOfPin.has(key)) this.netOfPin.set(key, next++);
      }
      if (!this.partState.has(part.id)) {
        this.partState.set(part.id, { ...(model.initial ?? {}) });
      }
    }
  }

  /** Current per-part interaction state, created on demand. */
  stateOf(partId: string): PartState {
    let s = this.partState.get(partId);
    if (!s) {
      s = {};
      this.partState.set(partId, s);
    }
    return s;
  }

  setPartState(partId: string, patch: PartState) {
    this.partState.set(partId, { ...this.stateOf(partId), ...patch });
  }

  /** What the sketch asserts on an MCU pin; null releases it. */
  setMcuDrive(partId: string, pin: string, drive: Drive | null) {
    const key = pinKey(partId, pin);
    if (drive) this.mcuDrives.set(key, drive);
    else this.mcuDrives.delete(key);
  }

  clearMcuDrives() {
    this.mcuDrives.clear();
  }

  /** Resolved state of the net a pin sits on. */
  pinState(partId: string, pin: string): NetState {
    return this.snapshot.pins.get(pinKey(partId, pin)) ?? FLOATING;
  }

  /**
   * A 0..1023 reading for analogRead. A wired potentiometer's wiper wins;
   * otherwise a digital level maps to the rail extremes, which is the honest
   * behavioural answer — this engine does not solve for intermediate voltages.
   */
  analogAt(partId: string, pin: string): number {
    const key = pinKey(partId, pin);
    const net = this.netOfPin.get(key);
    if (net !== undefined) {
      for (const part of this.circuit.parts) {
        if (part.type !== "wokwi-potentiometer") continue;
        if (this.netOfPin.get(pinKey(part.id, "SIG")) !== net) continue;
        const raw = this.stateOf(part.id).value;
        return typeof raw === "number" ? Math.max(0, Math.min(1023, raw)) : 0;
      }
      // Spec-authored sensors report a fixed reading on their output net.
      for (const source of this.models.analogSources) {
        if (this.netOfPin.get(pinKey(source.partId, source.pin)) !== net) continue;
        return Math.max(0, Math.min(1023, source.value));
      }
    }
    const level = this.pinState(partId, pin).level;
    return level === 1 ? 1023 : 0;
  }

  /** Resolves the whole circuit and returns the new snapshot. */
  step(): SimSnapshot {
    return this.settle();
  }

  /**
   * Merge, drive, resolve — repeated until the net states stop changing.
   */
  private settle(): SimSnapshot {
    let resolved = new Map<string, NetState>();
    let unstable = true;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const merged = new DisjointSet();

      const stateFor = (partId: string, pin: string): NetState => {
        const net = this.netOfPin.get(pinKey(partId, pin));
        if (net === undefined) return FLOATING;
        return resolved.get(merged.find(String(net))) ?? FLOATING;
      };

      // Phase 1: switches and passives merge nets before anything is driven.
      for (const part of this.circuit.parts) {
        const model = this.models.of(part.type);
        if (!model.shorts) continue;
        const ctx = { net: (pin: string) => stateFor(part.id, pin), state: this.stateOf(part.id) };
        for (const group of model.shorts(ctx)) {
          const nets = group
            .map((pin) => this.netOfPin.get(pinKey(part.id, pin)))
            .filter((n): n is number => n !== undefined);
          for (let i = 1; i < nets.length; i++) {
            merged.union(String(nets[0]!), String(nets[i]!));
          }
        }
      }

      // Phase 2: collect every drive onto its merged net.
      const drives = new Map<string, Drive[]>();
      const push = (net: number, drive: Drive) => {
        const root = merged.find(String(net));
        const list = drives.get(root);
        if (list) list.push(drive);
        else drives.set(root, [drive]);
      };

      for (const part of this.circuit.parts) {
        const model = this.models.of(part.type);

        // The sketch drives MCU pins; everything else drives itself.
        if (this.models.isMcu(part.type)) {
          for (const pin of model.pins) {
            const key = pinKey(part.id, pin);
            const net = this.netOfPin.get(key);
            if (net === undefined) continue;
            // Power pins are always driven by the board itself.
            if (pin === "5V" || pin === "3.3V" || pin === "VIN") push(net, "high");
            else if (pin.startsWith("GND")) push(net, "low");
            else {
              const d = this.mcuDrives.get(key);
              if (d) push(net, d);
            }
          }
          continue;
        }

        if (!model.drive) continue;
        const ctx = { net: (pin: string) => stateFor(part.id, pin), state: this.stateOf(part.id) };
        for (const pin of model.pins) {
          const net = this.netOfPin.get(pinKey(part.id, pin));
          if (net === undefined) continue;
          push(net, model.drive(ctx, pin));
        }
      }

      // Phase 3: resolve, and stop once nothing moved.
      const next = new Map<string, NetState>();
      for (const [root, list] of drives) next.set(root, resolveNet(list));

      const same =
        next.size === resolved.size &&
        [...next].every(([k, v]) => {
          const old = resolved.get(k);
          return old && old.level === v.level && old.conflict === v.conflict;
        });

      resolved = next;
      // The projection must use the merge that produced `resolved`, so record
      // it before the settle check rather than only on rounds that continue.
      this.lastMerge = merged;
      if (same) {
        unstable = false;
        break;
      }
    }

    return this.project(resolved, unstable);
  }

  private lastMerge = new DisjointSet();

  /** Fans the resolved net states back out to individual pins and outputs. */
  private project(resolved: Map<string, NetState>, unstable: boolean): SimSnapshot {
    const pins = new Map<string, NetState>();
    for (const [key, net] of this.netOfPin) {
      pins.set(key, resolved.get(this.lastMerge.find(String(net))) ?? FLOATING);
    }

    const outputs = new Map<string, number>();
    for (const part of this.circuit.parts) {
      const model = this.models.of(part.type);
      if (!model.output) continue;
      outputs.set(
        part.id,
        model.output({
          net: (pin: string) => pins.get(pinKey(part.id, pin)) ?? FLOATING,
          state: this.stateOf(part.id),
        }),
      );
    }

    let conflicts = 0;
    for (const state of resolved.values()) if (state.conflict) conflicts++;

    this.snapshot = { pins, outputs, conflicts, unstable };
    return this.snapshot;
  }

  current(): SimSnapshot {
    return this.snapshot;
  }
}
