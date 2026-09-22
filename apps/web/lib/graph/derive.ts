/**
 * Reads the product graph out of the project rather than asking anyone to draw it.
 *
 * Almost every link an engineer would draw by hand is already implied by data
 * the project holds: a BOM line and a schematic part share a reference
 * designator, a footprint names the part it realises, a KCL assembly imports
 * the parts it contains, a validation check names its target path. Asking a
 * user to restate those relationships is asking them to maintain a second copy
 * of something the tools already agree on, and second copies drift. So the
 * deriver reads them, and `syncProductGraph` re-runs it after every change.
 *
 * What it will NOT do is guess. Five edge kinds — SATISFIES, IMPLEMENTED_BY,
 * DEPENDS_ON, DERIVED_FROM, MITIGATES — encode judgement that is simply not
 * present in the data. Which component satisfies which requirement is a design
 * decision, not a fact recoverable from a name. Those edges only ever come
 * from a person or from the copilot, with a rationale attached, and this module
 * refuses to invent them (see AUTHORED_ONLY_EDGE_KINDS).
 *
 * Heuristics that ARE allowed carry a confidence below 1.0, so a chain of
 * guesses decays out of impact results instead of being presented as fact.
 */

import { parseKclModuleImports } from "@foundry/cad";
import type { CircuitDoc } from "@/lib/circuit/catalog";
import type { FitInput, FitSimulation } from "@/lib/integration/fit-check";
import { buildNets } from "@/lib/pcb/netlist";
import { isFirmwarePath } from "@/lib/sim/arduino";
import { findMcuPart } from "@/lib/sim/models";
import {
  cadAssemblyKey,
  cadPartKey,
  checkKey,
  circuitPartKey,
  codeFileKey,
  componentKey,
  footprintKey,
  mcuPinKey,
  netKey,
  normalizeRefDes,
  requirementKey,
  type DerivedEdge,
  type DerivedNode,
  type ProductEdgeKind,
} from "./types";

export type GraphInput = FitInput & {
  /**
   * The fit check's own simulation run, reused rather than repeated. It is
   * what makes firmware->pin edges behavioural instead of textual.
   */
  simulation?: FitSimulation;
};

export type DeriveResult = { nodes: DerivedNode[]; edges: DerivedEdge[] };

/**
 * Part types that legitimately have no firmware driving them.
 *
 * Without this list the "component has no driver" check fires on every
 * resistor and decoupling capacitor in the BOM, which is the fastest way to
 * teach someone to ignore the checks panel. Exported so the exclusion is
 * visible and unit-tested rather than buried in a predicate.
 */
export const PASSIVE_PART_TYPES: ReadonlySet<string> = new Set([
  "wokwi-resistor",
  "wokwi-capacitor",
  "wokwi-electrolytic-capacitor",
  "wokwi-inductor",
  "wokwi-diode",
  "wokwi-led",
  "wokwi-rgb-led",
  "wokwi-pushbutton",
  "wokwi-slide-switch",
  "wokwi-dip-switch-8",
  "wokwi-potentiometer",
  "wokwi-battery",
  "wokwi-9v-battery",
  "wokwi-battery-holder",
  "wokwi-junction",
  "wokwi-vcc",
  "wokwi-gnd",
]);

/** Power rails are wired to everything, so pin edges through them are noise. */
const POWER_PIN = /^(vcc|vdd|v5|5v|3v3|3\.3v|vin|gnd|gnd\.\d+|agnd|dgnd)$/i;

const truncate = (text: string, max = 80) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/**
 * Cheap, stable content hash. Not cryptographic — its only job is to answer
 * "did this artifact change since we flagged it?", so collision resistance
 * matters far less than being synchronous and dependency-free (this module is
 * pure and runs in the browser bundle too).
 */
export function contentHashOf(content: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13);
  }
  return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).padStart(16, "0");
}

const node = (n: DerivedNode): DerivedNode => n;

function edge(
  from: string,
  to: string,
  kind: ProductEdgeKind,
  rule: string,
  confidence: number,
  evidence: string,
): DerivedEdge {
  return { from, to, kind, rule, confidence, evidence, origin: "DERIVED" };
}

/** Label for a schematic part: its refDes if it has one, else its type. */
const partLabel = (part: CircuitDoc["parts"][number]) =>
  part.label?.trim() || part.type.replace(/^wokwi-/, "");

export function deriveGraph(input: GraphInput): DeriveResult {
  const nodes: DerivedNode[] = [];
  const edges: DerivedEdge[] = [];

  // ---- Nodes from rows ----

  for (const req of input.requirements) {
    if (!req.id) continue;
    nodes.push(
      node({
        kind: "REQUIREMENT",
        refKey: requirementKey(req.id),
        refId: req.id,
        label: truncate(req.title),
        origin: "DERIVED",
        originDetail: "derive:n:requirement",
        contentHash: contentHashOf(
          `${req.title}|${req.priority}|${req.minValue ?? ""}|${req.maxValue ?? ""}|${req.unit ?? ""}`,
        ),
      }),
    );
  }

  for (const component of input.components) {
    if (!component.id) continue;
    nodes.push(
      node({
        kind: "COMPONENT",
        refKey: componentKey(component.id),
        refId: component.id,
        label: component.refDes ? `${component.refDes} ${component.name}` : component.name,
        origin: "DERIVED",
        originDetail: "derive:n:component",
        contentHash: contentHashOf(
          [
            component.name,
            component.refDes ?? "",
            component.quantity ?? 1,
            component.currentDrawMa ?? "",
            component.capacityMah ?? "",
            component.nominalVoltageV ?? "",
          ].join("|"),
        ),
      }),
    );
  }

  for (const check of input.validationChecks) {
    if (!check.id) continue;
    nodes.push(
      node({
        kind: "CHECK",
        refKey: checkKey(check.id),
        refId: check.id,
        label: truncate(check.title),
        origin: "DERIVED",
        originDetail: "derive:n:check",
        contentHash: contentHashOf(`${check.title}|${check.targetPath ?? ""}`),
      }),
    );
  }

  for (const file of input.codeFiles) {
    if (!file.id || !isFirmwarePath(file.path)) continue;
    nodes.push(
      node({
        kind: "FIRMWARE_FILE",
        refKey: codeFileKey(file.id),
        refId: file.id,
        label: file.path,
        origin: "DERIVED",
        originDetail: "derive:n:firmware",
        contentHash: contentHashOf(file.content),
      }),
    );
  }

  for (const component of input.cad) {
    const isAssembly = component.kind === "assembly";
    // Instructions and other docs are not geometry and nothing depends on them.
    if (!isAssembly && component.kind !== "part") continue;
    nodes.push(
      node({
        kind: isAssembly ? "CAD_ASSEMBLY" : "CAD_PART",
        refKey: isAssembly ? cadAssemblyKey(component.path) : cadPartKey(component.path),
        label: component.path,
        origin: "DERIVED",
        originDetail: "derive:n:cad",
        contentHash: contentHashOf(component.content ?? component.path),
      }),
    );
  }

  // ---- Nodes and edges from the schematic ----

  const circuit = input.circuit;
  const partsById = new Map<string, CircuitDoc["parts"][number]>();

  if (circuit) {
    for (const part of circuit.parts) {
      partsById.set(part.id, part);
      nodes.push(
        node({
          kind: "CIRCUIT_PART",
          refKey: circuitPartKey(part.id),
          label: partLabel(part),
          data: { type: part.type },
          origin: "DERIVED",
          originDetail: "derive:n:circuit-part",
          contentHash: contentHashOf(`${part.type}|${part.label ?? ""}`),
        }),
      );
    }

    // COMPONENT -> CIRCUIT_PART. The reference designator is the join the two
    // documents already share; a name match is the fallback when the BOM line
    // has no refDes, and it is explicitly a guess.
    const partsByRefDes = new Map<string, CircuitDoc["parts"][number]>();
    for (const part of circuit.parts) {
      if (part.label) partsByRefDes.set(normalizeRefDes(part.label), part);
    }

    for (const component of input.components) {
      if (!component.id) continue;
      const refDes = component.refDes ? normalizeRefDes(component.refDes) : null;
      const exact = refDes ? partsByRefDes.get(refDes) : undefined;
      if (exact) {
        edges.push(
          edge(
            componentKey(component.id),
            circuitPartKey(exact.id),
            "REALIZED_BY",
            "refdes-match",
            1,
            `BOM line and schematic part share ${refDes}`,
          ),
        );
        continue;
      }
      const needle = component.name.trim().toLowerCase();
      if (needle.length < 3) continue;
      const loose = circuit.parts.find(
        (part) =>
          partLabel(part).toLowerCase().includes(needle) ||
          part.type.toLowerCase().includes(needle.replace(/\s+/g, "-")),
      );
      if (loose) {
        edges.push(
          edge(
            componentKey(component.id),
            circuitPartKey(loose.id),
            "REALIZED_BY",
            "name-match",
            0.6,
            `No reference designator; matched "${component.name}" to ${partLabel(loose)} by name`,
          ),
        );
      }
    }

    // Nets, and what sits on them.
    const nets = buildNets(circuit);
    const mcu = findMcuPart(circuit);
    for (const net of nets) {
      nodes.push(
        node({
          kind: "NET",
          refKey: netKey(net.name),
          label: `net ${net.name}`,
          origin: "DERIVED",
          originDetail: "derive:n:net",
          contentHash: contentHashOf(
            net.nodes
              .map((n) => `${n.partId}.${n.pin}`)
              .sort()
              .join(","),
          ),
        }),
      );

      const seenParts = new Set<string>();
      for (const netNode of net.nodes) {
        if (!partsById.has(netNode.partId)) continue;
        if (!seenParts.has(netNode.partId)) {
          seenParts.add(netNode.partId);
          edges.push(
            edge(
              circuitPartKey(netNode.partId),
              netKey(net.name),
              "CONNECTS",
              "wire-net",
              1,
              `wired to ${net.name}`,
            ),
          );
        }
        // MCU pins become their own nodes so firmware can attach to the exact
        // pin it drives rather than to the whole microcontroller.
        if (mcu && netNode.partId === mcu.id && !POWER_PIN.test(netNode.pin)) {
          const pinKey = mcuPinKey(mcu.id, netNode.pin);
          if (!nodes.some((n) => n.refKey === pinKey)) {
            nodes.push(
              node({
                kind: "MCU_PIN",
                refKey: pinKey,
                label: `${partLabel(mcu)} pin ${netNode.pin}`,
                origin: "DERIVED",
                originDetail: "derive:n:mcu-pin",
              }),
            );
          }
          // NET -> MCU_PIN: what a pin means depends on what is wired to it,
          // so rewiring the net is what puts the pin — and the firmware that
          // uses it — in question, not the other way round.
          edges.push(
            edge(
              netKey(net.name),
              pinKey,
              "CONNECTS",
              "pin-net",
              1,
              `${net.name} lands on this pin`,
            ),
          );
        }
      }
    }

    // FIRMWARE -> MCU_PIN, from what the simulation actually touched.
    //
    // This is behavioural, not textual: the pins come from the simulator's own
    // record of reads and writes, so a pin reached through a variable, a
    // helper function or a loop index is caught, where grepping the source for
    // digitalWrite(13, ...) would miss it.
    const simulation = input.simulation;
    if (mcu && simulation?.ran) {
      const firmwareFile = input.codeFiles.find((f) => f.id && f.path === simulation.firmwarePath);
      if (firmwareFile?.id) {
        for (const pin of simulation.pinsExercised) {
          if (POWER_PIN.test(pin)) continue;
          const pinKey = mcuPinKey(mcu.id, pin);
          if (!nodes.some((n) => n.refKey === pinKey)) {
            nodes.push(
              node({
                kind: "MCU_PIN",
                refKey: pinKey,
                label: `${partLabel(mcu)} pin ${pin}`,
                origin: "DERIVED",
                originDetail: "derive:n:mcu-pin",
              }),
            );
          }
          // MCU_PIN -> FIRMWARE_FILE: the firmware is the dependent. Change
          // what sits on the pin and the code reading or driving it follows.
          edges.push(
            edge(
              pinKey,
              codeFileKey(firmwareFile.id),
              "DRIVES",
              "firmware-pin",
              1,
              `${simulation.firmwarePath} exercised pin ${pin} when run`,
            ),
          );
        }
      }
    }
  }

  // ---- Footprints ----

  for (const [boardIndex, board] of (input.pcb?.boards ?? []).entries()) {
    for (const footprint of board.footprints) {
      const key = footprintKey(boardIndex, footprint.refDes);
      nodes.push(
        node({
          kind: "FOOTPRINT",
          refKey: key,
          label: `${footprint.refDes} (${footprint.libraryId})`,
          origin: "DERIVED",
          originDetail: "derive:n:footprint",
          contentHash: contentHashOf(
            `${footprint.libraryId}|${footprint.xMm}|${footprint.yMm}|${footprint.rotationDeg}|${footprint.side}`,
          ),
        }),
      );
      // partId is a structural field the board editor sets, not a guess.
      if (footprint.partId && partsById.has(footprint.partId)) {
        edges.push(
          edge(
            circuitPartKey(footprint.partId),
            key,
            "REALIZED_BY",
            "footprint-partid",
            1,
            `footprint ${footprint.refDes} realises this part`,
          ),
        );
      }
    }
  }

  // ---- CAD containment and housing ----

  const cadParts = input.cad.filter((c) => c.kind === "part");
  for (const assembly of input.cad.filter((c) => c.kind === "assembly")) {
    if (!assembly.content) continue;
    for (const imported of parseKclModuleImports(assembly.content)) {
      const match = cadParts.find(
        (part) => part.path === imported.path || part.path.endsWith(`/${imported.path}`),
      );
      if (!match) continue;
      edges.push(
        edge(
          cadPartKey(match.path),
          cadAssemblyKey(assembly.path),
          "CONTAINS",
          "cad-import",
          1,
          `${assembly.path} imports ${imported.path}`,
        ),
      );
    }
  }

  // COMPONENT -> CAD_PART. A real but weak signal: the part that holds a
  // battery is usually named after it. Matching on individual significant
  // words rather than the whole BOM name is what makes this fire at all — a
  // line reading "Battery, LiPo 2000 mAh" never appears verbatim in
  // "parts/battery-bay.kcl", but "battery" does. Half confidence, so it
  // informs impact without ever being asserted as fact.
  for (const component of input.components) {
    if (!component.id) continue;
    const needles = significantWords(component.name).filter(
      (w) => w.length >= 4 && !GENERIC_PART_WORDS.has(w),
    );
    const refDes = component.refDes ? normalizeRefDes(component.refDes).toLowerCase() : null;
    if (refDes) needles.push(refDes);
    if (needles.length === 0) continue;

    for (const part of cadParts) {
      const haystack = `${part.path} ${part.name}`.toLowerCase();
      const hit = needles.find((needle) => haystack.includes(needle));
      if (!hit) continue;
      edges.push(
        edge(
          componentKey(component.id),
          cadPartKey(part.path),
          "HOUSES",
          "cad-houses",
          0.5,
          `"${part.path}" is named after "${hit}" in ${component.name}`,
        ),
      );
    }
  }

  // ---- Power ----

  const sources = input.components.filter((c) => c.id && c.capacityMah != null);
  const loads = input.components.filter((c) => c.id && c.currentDrawMa != null);
  for (const source of sources) {
    for (const load of loads) {
      if (source.id === load.id) continue;
      edges.push(
        edge(
          componentKey(source.id!),
          componentKey(load.id!),
          "POWERS",
          "power-budget",
          1,
          `${source.name} supplies ${load.name}`,
        ),
      );
    }
  }

  // ---- Checks ----

  // A check's targetPath is the user's own statement of what it covers, so it
  // is the strongest coverage signal available. Resolution order is most to
  // least specific; a targetPath that resolves to nothing is reported as a
  // finding rather than silently dropped (see checkOrphanTargets).
  const cadByPath = new Map(input.cad.map((c) => [c.path, c]));
  const filesByPath = new Map(input.codeFiles.filter((f) => f.id).map((f) => [f.path, f]));
  const componentsByRefDes = new Map(
    input.components.filter((c) => c.id && c.refDes).map((c) => [normalizeRefDes(c.refDes!), c]),
  );

  for (const check of input.validationChecks) {
    if (!check.id || !check.targetPath) continue;
    const target = check.targetPath.trim();

    const cad = cadByPath.get(target);
    if (cad) {
      edges.push(
        edge(
          cad.kind === "assembly" ? cadAssemblyKey(cad.path) : cadPartKey(cad.path),
          checkKey(check.id),
          "VERIFIED_BY",
          "check-targetpath",
          1,
          `check targets ${target}`,
        ),
      );
      continue;
    }

    const file = filesByPath.get(target);
    if (file?.id) {
      edges.push(
        edge(
          codeFileKey(file.id),
          checkKey(check.id),
          "VERIFIED_BY",
          "check-targetpath",
          1,
          `check targets ${target}`,
        ),
      );
      continue;
    }

    const component = componentsByRefDes.get(normalizeRefDes(target));
    if (component?.id) {
      edges.push(
        edge(
          componentKey(component.id),
          checkKey(check.id),
          "VERIFIED_BY",
          "check-targetpath",
          1,
          `check targets ${target}`,
        ),
      );
    }
    // Unresolved: deliberately no edge. checkOrphanTargets reports it.
  }

  // REQUIREMENT -> CHECK by wording, only where nothing stronger exists. Title
  // overlap is genuinely weak evidence, so it is half confidence and never
  // competes with an explicit targetPath.
  const checksWithTarget = new Set(
    edges.filter((e) => e.rule === "check-targetpath").map((e) => e.to),
  );
  for (const req of input.requirements) {
    if (!req.id) continue;
    const words = significantWords(req.title);
    if (words.length < 2) continue;
    for (const check of input.validationChecks) {
      if (!check.id || checksWithTarget.has(checkKey(check.id))) continue;
      const haystack = check.title.toLowerCase();
      const hits = words.filter((w) => haystack.includes(w)).length;
      if (hits >= Math.min(3, words.length)) {
        edges.push(
          edge(
            requirementKey(req.id),
            checkKey(check.id),
            "VERIFIED_BY",
            "check-title-match",
            0.5,
            `check title echoes "${truncate(req.title, 40)}"`,
          ),
        );
      }
    }
  }

  // A requirement naming its verification method by title or path is stating
  // coverage explicitly, which beats wording overlap but not a targetPath.
  for (const req of input.requirements) {
    if (!req.id || !req.verificationMethod) continue;
    const method = req.verificationMethod.trim().toLowerCase();
    if (method.length < 4) continue;
    for (const check of input.validationChecks) {
      if (!check.id) continue;
      if (
        check.title.toLowerCase().includes(method) ||
        method.includes(check.title.toLowerCase())
      ) {
        edges.push(
          edge(
            requirementKey(req.id),
            checkKey(check.id),
            "VERIFIED_BY",
            "req-verification-method",
            0.7,
            `requirement names "${req.verificationMethod}" as its verification method`,
          ),
        );
      }
    }
  }

  return { nodes: dedupeNodes(nodes), edges: dedupeEdges(edges) };
}

/**
 * Words that appear in half the BOM and half the CAD tree, so a match on one
 * says nothing. Without this, "ESP32 module" claims to be housed by every part
 * whose name contains "module".
 */
const GENERIC_PART_WORDS = new Set([
  "module",
  "board",
  "assembly",
  "part",
  "unit",
  "generic",
  "standard",
  "mini",
  "micro",
  "small",
  "large",
  "main",
  "kit",
]);

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "for",
  "with",
  "in",
  "on",
  "at",
  "be",
  "is",
  "are",
  "must",
  "should",
  "shall",
  "may",
  "not",
  "than",
  "least",
  "most",
  "system",
  "device",
  "product",
  "unit",
]);

function significantWords(title: string): string[] {
  return [
    ...new Set(
      title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
    ),
  ];
}

/** First occurrence wins, so an earlier, stronger node is never overwritten. */
function dedupeNodes(nodes: DerivedNode[]): DerivedNode[] {
  const byKey = new Map<string, DerivedNode>();
  for (const n of nodes) if (!byKey.has(n.refKey)) byKey.set(n.refKey, n);
  return [...byKey.values()];
}

/**
 * One edge per (from, to, kind) — the database's unique key. When two rules
 * produce the same edge the more confident one wins, so an exact refDes match
 * is never demoted by a name guess that happened to run later.
 */
function dedupeEdges(edges: DerivedEdge[]): DerivedEdge[] {
  const byKey = new Map<string, DerivedEdge>();
  for (const e of edges) {
    const key = `${e.from}|${e.to}|${e.kind}`;
    const existing = byKey.get(key);
    if (!existing || e.confidence > existing.confidence) byKey.set(key, e);
  }
  return [...byKey.values()];
}
