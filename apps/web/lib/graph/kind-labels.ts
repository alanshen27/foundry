/**
 * Shared vocabulary for rendering graph nodes in a list: grouping order,
 * plain-English headings, which kinds are wiring intermediates rather than
 * work, and which workspace tab a kind's artifact opens on.
 *
 * Extracted out of the impact panel so the branch-compare panel groups nodes
 * exactly the same way, rather than drifting from a second, hand-copied table.
 */

/**
 * Group order, most consequential first.
 *
 * Traversal order is not reading order. A walk from the battery happens to
 * reach the bench test and the schematic part before the requirement and the
 * firmware, but "the 8 hour requirement is in question" is the sentence that
 * changes what someone does next, so it goes at the top.
 */
export const KIND_ORDER: string[] = [
  "REQUIREMENT",
  "COMPONENT",
  "FIRMWARE_FILE",
  "CAD_ASSEMBLY",
  "CAD_PART",
  "CHECK",
  "TASK",
  "RISK",
  "BRIEF",
  "DECISION",
  // Structural intermediates, folded away by default.
  "CIRCUIT_PART",
  "FOOTPRINT",
  "NET",
  "MCU_PIN",
];

/**
 * Kinds that explain HOW the impact travels rather than naming work to do.
 *
 * They belong in the result — the chain from a battery to a firmware file runs
 * through a net and a pin, and hiding that would make the path unreadable —
 * but nobody opens a net and revises it. Collapsed by default so a list opens
 * on the things a person acts on rather than a pile of wiring intermediates.
 */
export const STRUCTURAL_KINDS = new Set(["CIRCUIT_PART", "NET", "MCU_PIN", "FOOTPRINT"]);

/** Plain-English group headings, so a panel does not leak enum names. */
export const KIND_LABEL: Record<string, string> = {
  REQUIREMENT: "Requirements",
  COMPONENT: "Bill of materials",
  CHECK: "Validation checks",
  FIRMWARE_FILE: "Firmware",
  CIRCUIT_PART: "Schematic",
  NET: "Nets",
  FOOTPRINT: "Board",
  MCU_PIN: "Pins",
  CAD_PART: "CAD parts",
  CAD_ASSEMBLY: "Assembly",
  TASK: "Tasks",
  RISK: "Risks",
  BRIEF: "Brief",
  DECISION: "Decisions",
};

/** Which workspace tab an artifact lives on, for a row's link. */
export function viewFor(kind: string): string | null {
  switch (kind) {
    case "REQUIREMENT":
    case "BRIEF":
      return "ideate";
    case "COMPONENT":
      return "sourcing";
    case "CHECK":
      return "checks";
    case "FIRMWARE_FILE":
      return "code";
    case "CIRCUIT_PART":
    case "NET":
    case "MCU_PIN":
      return "schematic";
    case "FOOTPRINT":
      return "pcb";
    case "CAD_PART":
    case "CAD_ASSEMBLY":
      return "assembly";
    default:
      return null;
  }
}

/** Groups a flat node list by kind and sorts groups by KIND_ORDER. */
export function groupByKind<T extends { kind: string }>(
  nodes: T[],
  { includeStructural = true }: { includeStructural?: boolean } = {},
): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const node of nodes) {
    if (STRUCTURAL_KINDS.has(node.kind) && !includeStructural) continue;
    const bucket = groups.get(node.kind);
    if (bucket) bucket.push(node);
    else groups.set(node.kind, [node]);
  }
  return [...groups.entries()].sort(([a], [b]) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
}
