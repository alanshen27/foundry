import { linkedAssemblyStatus, normalizeCadDoc, stableCadHash } from "@foundry/cad";
import { normalizeCircuitDoc } from "@/lib/circuit/catalog";
import { runCircuitErc } from "@/lib/circuit/erc";
import { circuitForGroup, partitionBoards } from "@/lib/circuit/groups";
import { normalizePcbSet } from "@/lib/pcb/doc";
import { runDrc } from "@/lib/pcb/drc";
import { pcbMechanicalSourceHash } from "@/lib/pcb/mechanical";
import { buildNets, buildRatsnest, padNetMap } from "@/lib/pcb/netlist";
import { buildCopperGraph } from "@/lib/pcb/routing";

export type EngineeringStep = "schematic" | "pcb" | "cad" | "assembly";
export type EngineeringTarget = {
  view: "schematic" | "pcb" | "model" | "assembly";
  boardId?: string;
  componentId?: string;
};
export type EngineeringIssue = {
  id: string;
  stage: EngineeringStep;
  severity: "error" | "warning" | "info";
  title: string;
  detail: string;
  target: EngineeringTarget;
};
export type EngineeringReadiness = {
  label: "LOCAL / UNVERIFIED";
  stages: Array<{
    id: EngineeringStep;
    label: string;
    state: "missing" | "attention" | "outdated" | "current";
    summary: string;
  }>;
  issues: EngineeringIssue[];
  counts: { errors: number; warnings: number; boards: number; parts: number };
};

function listNames(names: string[]): string {
  return names.slice(0, 6).join(", ") + (names.length > 6 ? ` and ${names.length - 6} more` : "");
}

/** Current saved documents only. These local consistency checks are not engineering approval. */
export function buildEngineeringReadiness(input: {
  circuit: unknown;
  pcb: unknown;
  cad: unknown;
  components?: readonly unknown[];
}): EngineeringReadiness {
  const circuit = normalizeCircuitDoc(input.circuit);
  const boards = input.pcb ? normalizePcbSet(input.pcb).boards : [];
  const cad = input.cad ? normalizeCadDoc(input.cad) : null;
  const parts = cad?.components.filter((part) => part.kind === "part") ?? [];
  const issues: EngineeringIssue[] = [];
  const add = (issue: EngineeringIssue) => issues.push(issue);
  const legacyParts = parts.filter((part) => part.path.endsWith(".kcl"));
  if (cad?.engine === "build123d" && legacyParts.length)
    add({
      id: "cad:legacy-kcl",
      stage: "cad",
      severity: "warning",
      title: "Convert legacy CAD parts",
      detail:
        "Preserved KCL parts are excluded from new Python assemblies until converted: " +
        listNames(legacyParts.map((part) => part.name)),
      target: { view: "model", componentId: legacyParts[0]?.id },
    });
  const partition = partitionBoards(circuit);
  const schematicIds = new Set(circuit.parts.map((part) => part.id));

  if (!circuit.parts.length) {
    add({
      id: "schematic:missing",
      stage: "schematic",
      severity: "error",
      title: "Start the schematic",
      detail: "Add the product's electronic parts and their connections.",
      target: { view: "schematic" },
    });
  }
  const erc = runCircuitErc(circuit);
  for (const code of new Set(erc.map((issue) => issue.code))) {
    const grouped = erc.filter((issue) => issue.code === code);
    add({
      id: `erc:${code}`,
      stage: "schematic",
      severity: grouped.some((issue) => issue.severity === "error") ? "error" : "warning",
      title: `${grouped.length} schematic ${grouped.length === 1 ? "issue" : "issues"}`,
      detail: listNames(grouped.map((issue) => issue.message)),
      target: { view: "schematic" },
    });
  }
  if (partition.overlaps.length) {
    add({
      id: "schematic:overlapping-regions",
      stage: "schematic",
      severity: "error",
      title: "Board regions overlap",
      detail: "Separate overlapping schematic regions so each part has one board assignment.",
      target: { view: "schematic" },
    });
  }
  if (circuit.groups.length && partition.ungroupedPartIds.length) {
    add({
      id: "schematic:ungrouped",
      stage: "schematic",
      severity: "warning",
      title: "Parts are outside board regions",
      detail: `${partition.ungroupedPartIds.length} parts need a board assignment or an explicit off-board connection.`,
      target: { view: "schematic" },
    });
  }
  if (partition.crossings.length) {
    add({
      id: "schematic:interconnects",
      stage: "schematic",
      severity: "warning",
      title: "Review connections between boards",
      detail: `${partition.crossings.length} nets cross board regions. Confirm connectors and cables; copper routing alone cannot validate them.`,
      target: { view: "schematic" },
    });
  }

  if (!boards.length) {
    add({
      id: "pcb:missing",
      stage: "pcb",
      severity: "error",
      title: "Create the PCB layout",
      detail: "Choose footprints for the schematic and place them on a board.",
      target: { view: "pcb" },
    });
  }
  const placements = new Map<string, Array<{ boardId: string; refDes: string }>>();
  for (const board of boards) {
    for (const footprint of board.footprints) {
      if (!footprint.partId) continue;
      const existing = placements.get(footprint.partId) ?? [];
      existing.push({ boardId: board.id!, refDes: footprint.refDes });
      placements.set(footprint.partId, existing);
    }
  }
  const unplaced = circuit.parts.filter((part) => !placements.has(part.id));
  if (boards.length && unplaced.length) {
    add({
      id: "pcb:unplaced",
      stage: "pcb",
      severity: "error",
      title: `${unplaced.length} schematic parts need footprints`,
      detail: listNames(unplaced.map((part) => part.label ?? part.id)),
      target: { view: "pcb", boardId: boards[0]?.id },
    });
  }
  for (const [partId, owners] of placements) {
    if (owners.length > 1) {
      add({
        id: `pcb:duplicate:${partId}`,
        stage: "pcb",
        severity: "error",
        title: "A schematic part has multiple footprints",
        detail: `${partId}: ${listNames(owners.map((owner) => owner.refDes))}. Keep one physical assignment for each schematic part.`,
        target: { view: "pcb", boardId: owners[0]?.boardId },
      });
    }
    if (!schematicIds.has(partId)) {
      add({
        id: `pcb:removed:${partId}`,
        stage: "pcb",
        severity: "error",
        title: "Footprint points to a removed schematic part",
        detail: `${listNames(owners.map((owner) => owner.refDes))} references ${partId}. Relink it or mark it as a board-only feature.`,
        target: { view: "pcb", boardId: owners[0]?.boardId },
      });
    }
  }
  const physicalCrossings = buildNets(circuit).filter(
    (net) =>
      new Set(
        net.nodes.flatMap((node) =>
          (placements.get(node.partId) ?? []).map((owner) => owner.boardId),
        ),
      ).size > 1,
  );
  if (physicalCrossings.length && !partition.crossings.length) {
    add({
      id: "pcb:interconnects",
      stage: "pcb",
      severity: "warning",
      title: "Review wiring between physical boards",
      detail: `${listNames(physicalCrossings.map((net) => net.name))}. Confirm the connector pinout and cable for each shared net.`,
      target: { view: "pcb" },
    });
  }
  let staleCad = false;
  for (const board of boards) {
    const target: EngineeringTarget = { view: "pcb", boardId: board.id };
    const boardName = board.name ?? board.id ?? "Board";
    const boardCircuit = circuitForGroup(circuit, board.groupId ?? null);
    const boardPartIds = new Set(boardCircuit.parts.map((part) => part.id));
    const wrongRegion = board.footprints.filter(
      (footprint) =>
        footprint.partId &&
        schematicIds.has(footprint.partId) &&
        !boardPartIds.has(footprint.partId),
    );
    if (wrongRegion.length) {
      add({
        id: `pcb:${board.id}:wrong-region`,
        stage: "pcb",
        severity: "error",
        title: `${boardName}: footprints belong to another board region`,
        detail: listNames(wrongRegion.map((footprint) => footprint.refDes)),
        target,
      });
    }
    if (board.groupId && !circuit.groups.some((group) => group.id === board.groupId)) {
      add({
        id: `pcb:${board.id}:missing-region`,
        stage: "pcb",
        severity: "error",
        title: `${boardName}: board region is missing`,
        detail: "Choose an existing schematic region for this board.",
        target,
      });
    }
    const copper = buildCopperGraph(board, padNetMap(boardCircuit, board));
    const ratsnest = buildRatsnest(boardCircuit, board, copper);
    if (ratsnest.issues.unmappedPins.length) {
      add({
        id: `pcb:${board.id}:unmapped`,
        stage: "pcb",
        severity: "error",
        title: `${boardName}: pin mappings are incomplete`,
        detail: listNames(ratsnest.issues.unmappedPins.map((pin) => `${pin.refDes}.${pin.pin}`)),
        target,
      });
    }
    const drc = runDrc(board, ratsnest, copper);
    // Mapping issues above carry the useful identities; avoid repeating newer DRC summaries.
    const derivedMappingRules = new Set<string>([
      "unlinked-parts",
      "unmapped-pins",
      "dangling-footprint",
    ]);
    const rules = drc.violations.filter((issue) => !derivedMappingRules.has(issue.rule));
    for (const rule of new Set(rules.map((issue) => issue.rule))) {
      const grouped = rules.filter((issue) => issue.rule === rule);
      add({
        id: `pcb:${board.id}:drc:${rule}`,
        stage: "pcb",
        severity: grouped.some((issue) => issue.severity === "error") ? "error" : "warning",
        title: `${boardName}: ${rule.replaceAll("-", " ")}`,
        detail: listNames(grouped.map((issue) => issue.message)),
        target,
      });
    }

    const boardParts = parts.filter(
      (part) => part.source?.kind === "pcb" && part.source.boardId === board.id,
    );
    if (!boardParts.length) {
      staleCad = true;
      add({
        id: `cad:${board.id}:missing`,
        stage: "cad",
        severity: "error",
        title: `${boardName} is missing from CAD`,
        detail: "Update CAD from boards to create its linked mechanical part.",
        target: { view: "model" },
      });
    }
    for (const part of boardParts) {
      const source = part.source!;
      if (source.sourceHash !== pcbMechanicalSourceHash(board)) {
        staleCad = true;
        add({
          id: `cad:${board.id}:outdated`,
          stage: "cad",
          severity: "error",
          title: `${boardName}: CAD is out of date`,
          detail:
            "The board geometry changed after its CAD part was generated. Update CAD from boards before rebuilding the assembly.",
          target: { view: "model", componentId: part.id },
        });
      } else if (source.generatedHash !== stableCadHash(part.content)) {
        staleCad = true;
        add({
          id: `cad:${board.id}:edited`,
          stage: "cad",
          severity: "warning",
          title: `${boardName}: generated CAD was edited`,
          detail:
            "Review the manual changes. Updating CAD from boards replaces generated board geometry.",
          target: { view: "model", componentId: part.id },
        });
      }
    }
    if (boardParts.length > 1) {
      add({
        id: `cad:${board.id}:duplicate`,
        stage: "cad",
        severity: "error",
        title: `${boardName} has duplicate linked CAD parts`,
        detail: "Keep one source-linked mechanical part for this board.",
        target: { view: "model", componentId: boardParts[0]?.id },
      });
    }
    const unknownHeights = board.footprints.filter(
      (footprint) =>
        !footprint.libraryId.startsWith("MountingHole") &&
        !(typeof footprint.bodyHeightMm === "number" && footprint.bodyHeightMm > 0),
    );
    if (unknownHeights.length) {
      add({
        id: `cad:${board.id}:heights`,
        stage: "cad",
        severity: "warning",
        title: `${boardName}: component heights are unknown`,
        detail: `${listNames(unknownHeights.map((footprint) => footprint.refDes))}. Assembly component bodies are approximate; confirm enclosure clearance separately.`,
        target,
      });
    }
  }
  for (const part of parts) {
    if (part.source?.kind === "pcb" && !boards.some((board) => board.id === part.source!.boardId)) {
      staleCad = true;
      add({
        id: `cad:removed-board:${part.id}`,
        stage: "cad",
        severity: "warning",
        title: `${part.name}: source board was removed`,
        detail: "Review this preserved CAD part before including it in the assembly.",
        target: { view: "model", componentId: part.id },
      });
    }
  }

  // The shared CAD helper compares the generated preview and its source parts.
  const assembly = cad ? linkedAssemblyStatus(cad) : null;
  const assemblyState = !assembly?.linked
    ? "missing"
    : assembly.modified
      ? "edited"
      : assembly.stale || staleCad
        ? "stale"
        : "current";
  if (assemblyState !== "current") {
    const detail =
      assemblyState === "edited"
        ? "The product preview was edited outside the linked assembly. Rebuilding replaces those preview edits."
        : assemblyState === "stale"
          ? "Manufacturing parts or placements changed. Rebuild the linked assembly from the current sources."
          : "Build a linked assembly from the manufacturing parts to keep the product preview connected.";
    add({
      id: `assembly:${assemblyState}`,
      stage: "assembly",
      severity: "error",
      title:
        assemblyState === "missing"
          ? "Build the linked assembly"
          : "The linked assembly needs updating",
      detail,
      target: { view: "assembly" },
    });
  }
  if (cad?.assembly) {
    if (assembly?.missingComponentIds.length) {
      add({
        id: "assembly:removed-parts",
        stage: "assembly",
        severity: "error",
        title: "Assembly instances reference removed parts",
        detail: "Review missing source parts before rebuilding the product preview.",
        target: { view: "assembly" },
      });
    }
    const included = new Set(
      cad.assembly.instances
        .filter((instance) => instance.visible)
        .map((instance) => instance.componentId),
    );
    const missing = parts.filter(
      (part) =>
        part.source?.kind === "pcb" &&
        boards.some((board) => board.id === part.source!.boardId) &&
        !included.has(part.id),
    );
    if (missing.length) {
      add({
        id: "assembly:missing-boards",
        stage: "assembly",
        severity: "error",
        title: "Boards are missing from the product preview",
        detail: `${listNames(missing.map((part) => part.name))}. Include each board and make its instance visible.`,
        target: { view: "assembly" },
      });
    }
    const origin = (instance: (typeof cad.assembly.instances)[number]) =>
      instance.translationMm.x === 0 &&
      instance.translationMm.y === 0 &&
      instance.translationMm.z === 0 &&
      instance.rotationDeg.x === 0 &&
      instance.rotationDeg.y === 0 &&
      instance.rotationDeg.z === 0;
    const visible = cad.assembly.instances.filter((instance) => instance.visible);
    const originBoards = visible.filter((instance) => {
      const part = parts.find((item) => item.id === instance.componentId);
      return part?.source?.kind === "pcb" && origin(instance);
    });
    if (originBoards.length && visible.length > originBoards.length) {
      add({
        id: "assembly:pcb-at-origin",
        stage: "assembly",
        severity: "warning",
        title: "Place PCB mockups in the assembly",
        detail:
          "Board parts still sit at the origin. Give each pcb-* instance an explicit millimetre pose inside the enclosure; origin placement is UNVERIFIED and will overlap housings.",
        target: { view: "assembly" },
      });
    }
  }
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const stage = (
    id: EngineeringStep,
    label: string,
    missing: boolean,
    outdated: boolean,
    summary: string,
  ): EngineeringReadiness["stages"][number] => ({
    id,
    label,
    state: missing
      ? "missing"
      : outdated
        ? "outdated"
        : issues.some((issue) => issue.stage === id && issue.severity !== "info")
          ? "attention"
          : "current",
    summary,
  });
  return {
    label: "LOCAL / UNVERIFIED",
    stages: [
      stage(
        "schematic",
        "Schematic",
        !circuit.parts.length,
        false,
        `${circuit.parts.length} parts · ${circuit.wires.length} wires`,
      ),
      stage(
        "pcb",
        "PCB",
        !boards.length,
        false,
        `${boards.length} ${boards.length === 1 ? "board" : "boards"} · ${boards.reduce((sum, board) => sum + board.footprints.length, 0)} footprints`,
      ),
      stage(
        "cad",
        "CAD",
        !parts.length,
        staleCad && parts.length > 0,
        `${parts.length} manufacturing parts`,
      ),
      stage(
        "assembly",
        "Assembly",
        assemblyState === "missing",
        assemblyState !== "missing" && assemblyState !== "current",
        `${cad?.assembly?.instances.length ?? 0} linked instances`,
      ),
    ],
    issues,
    counts: { errors, warnings, boards: boards.length, parts: parts.length },
  };
}
