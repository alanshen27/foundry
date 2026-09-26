import type { CircuitDoc } from "@/lib/circuit/catalog";
import { createFootprint, footprintDef, padByPin, type PcbDoc } from "./doc";
import { buildRatsnest, resolvePad } from "./netlist";

export type SchematicPackageAssignment = {
  partId: string;
  libraryId: string;
  pinMap?: Record<string, string>;
};

export type SchematicSyncIssue = {
  code:
    | "missing-package"
    | "unknown-package"
    | "unknown-part"
    | "duplicate-assignment"
    | "duplicate-link"
    | "dangling-link"
    | "unmapped-pin"
    | "pin-map-conflict"
    | "package-changed";
  partId?: string;
  message: string;
};

export function wiredPinsForPart(circuit: CircuitDoc, partId: string): string[] {
  const pins = new Set<string>();
  for (const wire of circuit.wires) {
    if (wire.from.part === partId) pins.add(wire.from.pin);
    if (wire.to.part === partId) pins.add(wire.to.pin);
  }
  return [...pins].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Explicit package choices only. Existing placement and every copper feature survive. */
export function syncPcbFromSchematic(
  circuit: CircuitDoc,
  pcb: PcbDoc,
  assignments: SchematicPackageAssignment[],
): { doc: PcbDoc; added: string[]; updated: string[]; issues: SchematicSyncIssue[] } {
  const issues: SchematicSyncIssue[] = [];
  const added: string[] = [];
  const updated: string[] = [];
  const footprints = [...pcb.footprints];
  const parts = new Map(circuit.parts.map((part) => [part.id, part]));
  const assignmentCounts = new Map<string, number>();
  for (const assignment of assignments)
    assignmentCounts.set(assignment.partId, (assignmentCounts.get(assignment.partId) ?? 0) + 1);

  for (const assignment of assignments) {
    const part = parts.get(assignment.partId);
    if (!part) {
      issues.push({
        code: "unknown-part",
        partId: assignment.partId,
        message: `Part ${assignment.partId} is not in this board's schematic region.`,
      });
      continue;
    }
    if (assignmentCounts.get(part.id)! > 1) {
      if (
        !issues.some((issue) => issue.code === "duplicate-assignment" && issue.partId === part.id)
      )
        issues.push({
          code: "duplicate-assignment",
          partId: part.id,
          message: `Choose one package for ${part.label ?? part.id}.`,
        });
      continue;
    }
    const def = footprintDef(assignment.libraryId);
    if (!def) {
      issues.push({
        code: "unknown-package",
        partId: part.id,
        message: `Package ${assignment.libraryId} is not available; ${part.label ?? part.id} was unchanged.`,
      });
      continue;
    }
    const linked = footprints.filter((fp) => fp.partId === part.id);
    if (linked.length > 1) continue; // Report below; never guess which occurrence should survive.
    const previous = linked[0];
    const invalidPin = Object.entries(assignment.pinMap ?? {}).find(
      ([, pad]) => !padByPin(def.id, pad),
    );
    if (invalidPin) {
      issues.push({
        code: "unmapped-pin",
        partId: part.id,
        message: `${part.label ?? part.id}: pad ${invalidPin[1]} does not exist in ${def.id}.`,
      });
      continue;
    }
    const base =
      previous ??
      createFootprint(def.id, footprints, {
        xMm: Math.min(pcb.board.widthMm / 2, 5 + (added.length % 4) * 8),
        yMm: Math.min(pcb.board.heightMm / 2, 5 + Math.floor(added.length / 4) * 8),
      })!;
    const changedPackage = previous && previous.libraryId !== def.id;
    const next = {
      ...base,
      libraryId: def.id,
      partId: part.id,
      refDes: part.label?.trim() || base.refDes,
      value: part.attrs?.value ?? base.value,
      pinMap: assignment.pinMap ?? (changedPackage ? undefined : base.pinMap),
      // A new package's height must be supplied again; a different package is not the same envelope.
      bodyHeightMm: changedPackage ? undefined : base.bodyHeightMm,
    };
    if (previous) {
      if (JSON.stringify(next) !== JSON.stringify(previous)) {
        footprints[footprints.indexOf(previous)] = next;
        updated.push(next.id);
      }
      if (changedPackage)
        issues.push({
          code: "package-changed",
          partId: part.id,
          message: `${next.refDes}: package changed; review pad mapping, height, and existing routing.`,
        });
    } else {
      footprints.push(next);
      added.push(next.id);
    }
  }

  const doc = { ...pcb, footprints };
  for (const part of circuit.parts) {
    const linked = footprints.filter((fp) => fp.partId === part.id);
    if (!linked.length)
      issues.push({
        code: "missing-package",
        partId: part.id,
        message: `${part.label ?? part.id}: choose a physical package or link an existing footprint.`,
      });
    if (linked.length > 1)
      issues.push({
        code: "duplicate-link",
        partId: part.id,
        message: `${part.label ?? part.id} is linked to multiple footprints. Resolve the duplicate links.`,
      });
    if (linked.length === 1) {
      const padPins = new Map<string, string>();
      for (const pin of wiredPinsForPart(circuit, part.id)) {
        const pad = resolvePad(linked[0]!, pin);
        if (!pad) continue;
        const priorPin = padPins.get(pad.pin);
        if (priorPin && priorPin !== pin)
          issues.push({
            code: "pin-map-conflict",
            partId: part.id,
            message: `${linked[0]!.refDes}: pins ${priorPin} and ${pin} both map to pad ${pad.pin}. Review the mapping.`,
          });
        padPins.set(pad.pin, pin);
      }
    }
  }
  const ratsnest = buildRatsnest(circuit, doc);
  for (const issue of ratsnest.issues.unmappedPins)
    issues.push({
      code: "unmapped-pin",
      partId: issue.partId,
      message: `${issue.refDes}: map schematic pin ${issue.pin} to a package pad.`,
    });
  for (const fp of footprints) {
    if (fp.partId && !parts.has(fp.partId))
      issues.push({
        code: "dangling-link",
        partId: fp.partId,
        message: `${fp.refDes}: linked part ${fp.partId} is no longer in this board's region. The footprint and copper were kept.`,
      });
  }
  return { doc, added, updated, issues };
}
