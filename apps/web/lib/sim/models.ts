/**
 * Resolves the model used for each part on a schematic.
 *
 * Three sources, in order: the built-in catalog (lib/sim/parts.ts), a spec
 * carried by the document (lib/sim/part-spec.ts, authored for parts the catalog
 * does not cover), and finally an inert stand-in whose pins are inferred from
 * the wires so an unmodelled part cannot break the parts around it.
 */

import type { CircuitDoc } from "@/lib/circuit/catalog";
import { MCU_TYPES, partModel, type PartModel } from "@/lib/sim/parts";
import { compilePartSpec, inertModel, type PartSpec } from "@/lib/sim/part-spec";

export type ModelIndex = {
  /** Model for a part type, always defined (inert when nothing is known). */
  of: (type: string) => PartModel;
  /** Whether firmware drives this part's pins. */
  isMcu: (type: string) => boolean;
  /** Part types with neither a built-in model nor a spec. */
  unmodelled: string[];
  /** Analog readings a spec provides, keyed by part id. */
  analogSources: { partId: string; pin: string; value: number }[];
};

/** Pin names a part actually uses, taken from the wires that touch it. */
function pinsFromWires(doc: CircuitDoc, partId: string): string[] {
  const pins = new Set<string>();
  for (const wire of doc.wires) {
    if (wire.from.part === partId) pins.add(wire.from.pin);
    if (wire.to.part === partId) pins.add(wire.to.pin);
  }
  return [...pins];
}

export function buildModelIndex(doc: CircuitDoc): ModelIndex {
  const specs: Record<string, PartSpec> = doc.models ?? {};
  const compiled = new Map<string, PartModel>();
  const unmodelled = new Set<string>();
  const analogSources: ModelIndex["analogSources"] = [];

  for (const part of doc.parts) {
    if (compiled.has(part.type)) continue;
    const builtin = partModel(part.type);
    if (builtin) {
      compiled.set(part.type, builtin);
      continue;
    }
    const spec = specs[part.type];
    if (spec) {
      compiled.set(part.type, compilePartSpec(spec));
      continue;
    }
    unmodelled.add(part.type);
    compiled.set(part.type, inertModel(part.label ?? part.type, pinsFromWires(doc, part.id)));
  }

  for (const part of doc.parts) {
    const analog = specs[part.type]?.analog;
    if (analog) analogSources.push({ partId: part.id, pin: analog.pin, value: analog.value });
  }

  return {
    of: (type) => compiled.get(type) ?? inertModel(type, []),
    isMcu: (type) => MCU_TYPES.has(type) || Boolean(specs[type]?.mcu),
    unmodelled: [...unmodelled],
    analogSources,
  };
}

/** The MCU firmware runs on, if the schematic has one. */
export function findMcuPart(doc: CircuitDoc): CircuitDoc["parts"][number] | undefined {
  const index = buildModelIndex(doc);
  return doc.parts.find((part) => index.isMcu(part.type));
}
