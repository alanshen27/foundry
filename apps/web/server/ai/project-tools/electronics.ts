/**
 * Copilot tools: schematic capture, simulation part models, and PCB layout.
 */

import { z } from "zod";
import { prisma, type Prisma } from "@foundry/db";
import {
  PART_TYPES,
  normalizeCircuitDoc,
  unsupportedWokwiTypes,
  wokwiDiagramToDoc,
  type WokwiDiagram,
} from "@/lib/circuit/catalog";
import {
  emptyPcbSet,
  FOOTPRINT_IDS,
  normalizePcbDoc,
  normalizePcbSet,
  unsupportedFootprintIds,
} from "@/lib/pcb/doc";
import { buildRatsnest } from "@/lib/pcb/netlist";
import { runDrc } from "@/lib/pcb/drc";
import { buildModelIndex } from "@/lib/sim/models";
import { validatePartSpec, type PartSpec } from "@/lib/sim/part-spec";
import { circuitForGroup } from "@/lib/circuit/groups";
import { recordAudit } from "../../audit";
import { mutateModel3dDoc } from "../../cad-doc";
import { syncPcbCadPart } from "../../assemble-product";
import { type ToolContext, type ToolKit, guard, touchStage } from "./shared";

const driveEnum = z.enum(["float", "pulldown", "pullup", "low", "high"]);

/**
 * Behavioural internals for a part type the simulator has no model for. Data,
 * never code: the schema is what keeps a model-authored part safe to run.
 */
const specCondition = z.object({
  when: z.enum(["always", "toggled", "not-toggled", "pin"]).default("always"),
  whenPin: z.string().max(40).optional().describe('Pin to test, when `when` is "pin"'),
  is: z.enum(["high", "low", "floating"]).optional(),
});

const partSpecSchema = z.object({
  label: z.string().min(1).max(60),
  pins: z
    .array(z.string().min(1).max(40))
    .min(1)
    .max(60)
    .describe("Pin names, exactly as the wires reference them"),
  mcu: z.boolean().optional().describe("True when firmware runs on this part"),
  interactive: z.enum(["momentary", "latching"]).optional(),
  drives: z
    .array(specCondition.extend({ pin: z.string().max(40), drive: driveEnum }))
    .max(40)
    .optional()
    .describe("What the part asserts on a pin; later rules win"),
  shorts: z
    .array(specCondition.extend({ pins: z.array(z.string().max(40)).min(2).max(12) }))
    .max(20)
    .optional()
    .describe("Pins joined together, e.g. the two sides of a closed switch"),
  indicator: z
    .object({ high: z.string().max(40), low: z.string().max(40) })
    .optional()
    .describe("Lights up when `high` reads high and `low` reads low (LED semantics)"),
  analog: z
    .object({ pin: z.string().max(40), value: z.number().min(0).max(1023) })
    .optional()
    .describe("Fixed analogRead value this part presents on a pin"),
  note: z.string().max(300).optional().describe("What the real part does that this omits"),
});

const circuitSchema = z.object({
  parts: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        type: z
          .string()
          .regex(/^wokwi-[\w-]+$/)
          .describe(`A Wokwi element type. Supported: ${PART_TYPES.join(", ")}`),
        label: z.string().max(80).optional().describe("Reference label, e.g. R1, LED1"),
        attrs: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'Wokwi element attrs, e.g. {"value":"220"} for a resistor or {"color":"red"} for an LED',
          ),
        x: z.number(),
        y: z.number(),
        rotation: z.number().default(0),
      }),
    )
    .max(80),
  wires: z
    .array(
      z.object({
        id: z.string(),
        from: z.object({ part: z.string(), pin: z.string() }),
        to: z.object({ part: z.string(), pin: z.string() }),
      }),
    )
    .max(200),
  models: z
    .record(z.string(), partSpecSchema)
    .optional()
    .describe(
      "Simulation internals per part type, for types the simulator has no built-in model for. Without a spec the part is inert and the firmware cannot be exercised against it.",
    ),
});

type CircuitInput = z.infer<typeof circuitSchema>;

const pcbSchema = z.object({
  boardId: z
    .string()
    .max(60)
    .optional()
    .describe(
      "Which board to write, from get_project_state pcb.boards[].id. Omit for the only/active board. A new id creates a board.",
    ),
  boardName: z.string().max(60).optional().describe("Display name, e.g. 'Sensor board'."),
  groupId: z
    .string()
    .max(60)
    .optional()
    .describe(
      "Schematic region this board realises, from get_project_state schematicBoards[].id. Sets which parts and nets belong to it; omit when the schematic is not split.",
    ),
  board: z.object({
    widthMm: z.number().min(5).max(500).describe("Board outline width in mm"),
    heightMm: z.number().min(5).max(500).describe("Board outline height in mm"),
    thicknessMm: z.number().min(0.4).max(6.4).default(1.6),
    cornerRadiusMm: z.number().min(0).max(50).default(1),
  }),
  footprints: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        libraryId: z
          .string()
          .describe(`Footprint library id. Supported: ${FOOTPRINT_IDS.join(", ")}`),
        refDes: z.string().min(1).max(16).describe("Reference designator, e.g. R1, U1, J1"),
        value: z.string().max(64).optional().describe("e.g. 10k, 100nF, ESP32"),
        xMm: z.number().describe("Centre X from top-left of Edge.Cuts, mm"),
        yMm: z.number().describe("Centre Y from top-left of Edge.Cuts, mm"),
        rotationDeg: z.number().min(0).max(359).default(0),
        side: z.enum(["front", "back"]).default("front"),
        partId: z
          .string()
          .max(60)
          .optional()
          .describe(
            "Id of the schematic part this footprint realises (from get_project_state circuit.parts[].id). Set it to pull the schematic's nets onto the board — without it there is no ratsnest for this footprint.",
          ),
        pinMap: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'Schematic pin name -> pad pin, only where the names differ. E.g. a Wokwi LED on LED_0805 needs {"A":"1","C":"2"}; an MCU on SOIC-8 needs {"GND.1":"8","5V":"1"}. Pads are numbered 1..n (QFN centre pad is "EP", USB-C shield tabs are "S1"/"S2").',
          ),
      }),
    )
    .max(120),
  tracks: z
    .array(
      z.object({
        id: z.string().min(1).max(60).optional(),
        net: z
          .string()
          .max(60)
          .optional()
          .describe("Net name this track carries, from get_project_state netlist.nets[].name"),
        layer: z.enum(["F.Cu", "B.Cu"]).default("F.Cu"),
        widthMm: z.number().min(0.05).max(10).default(0.25),
        points: z
          .array(z.object({ xMm: z.number(), yMm: z.number() }))
          .min(2)
          .max(200)
          .describe(
            "Polyline vertices in board mm. Start and end exactly on pad centres (get_project_state reports each pad's position) or the track will not register as connected.",
          ),
      }),
    )
    .max(400)
    .optional()
    .describe("Routed copper. Omit to leave existing routing untouched."),
  vias: z
    .array(
      z.object({
        id: z.string().min(1).max(60).optional(),
        net: z.string().max(60).optional(),
        xMm: z.number(),
        yMm: z.number(),
        diameterMm: z.number().min(0.1).max(10).default(0.6),
        drillMm: z.number().min(0.05).max(9).default(0.3),
      }),
    )
    .max(200)
    .optional()
    .describe(
      "Plated through-holes joining F.Cu and B.Cu. A track changing layers needs a via at the changeover point, and both tracks must end exactly on it.",
    ),
  zones: z
    .array(
      z.object({
        id: z.string().min(1).max(60).optional(),
        net: z
          .string()
          .max(60)
          .optional()
          .describe("Net to pour, almost always GND. A pour with no net connects nothing."),
        layer: z.enum(["F.Cu", "B.Cu"]).default("F.Cu"),
        points: z
          .array(z.object({ xMm: z.number(), yMm: z.number() }))
          .min(3)
          .max(200)
          .describe("Outline polygon in board mm. Inset from the edge by at least the clearance."),
        clearanceMm: z.number().min(0.02).max(5).optional(),
      }),
    )
    .max(20)
    .optional()
    .describe(
      "Copper pours. A pour connects every pad of its net that it fully surrounds and clears around everything else, so a GND pour removes most GND routing. Omit to leave existing pours untouched.",
    ),
  rules: z
    .object({
      clearanceMm: z.number().min(0.02).max(5).default(0.2),
      trackWidthMm: z.number().min(0.05).max(10).default(0.25),
      viaDiameterMm: z.number().min(0.1).max(10).default(0.6),
      viaDrillMm: z.number().min(0.05).max(9).default(0.3),
      edgeClearanceMm: z.number().min(0).max(10).default(0.3),
    })
    .optional()
    .describe("Manufacturing constraints DRC checks against. Omit to keep the defaults."),
});

type PcbInput = z.infer<typeof pcbSchema>;

/** Schematic capture, simulation part models, and PCB layout. */
export function buildElectronicsTools(ctx: ToolContext, _kit: ToolKit) {
  const { projectId, branchId } = ctx;

  return {
    clear_circuit: {
      description: "Clear the circuit schematic (remove all parts and wires).",
      inputSchema: z.object({}),
      execute: async () =>
        guard(ctx, "electronics.edit", async (workspaceId) => {
          const data = { version: 2, parts: [], wires: [] };
          await prisma.designDoc.upsert({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "CIRCUIT" } },
            create: {
              projectId,
              branchId,
              kind: "CIRCUIT",
              data: data as unknown as Prisma.InputJsonValue,
              updatedById: ctx.userId,
            },
            update: { data: data as unknown as Prisma.InputJsonValue, updatedById: ctx.userId },
          });
          await recordAudit({
            type: "DesignDocUpdated",
            workspaceId,
            projectId,
            branchId,
            actorId: ctx.userId,
            actorType: "AGENT",
            payload: { kind: "CIRCUIT", cleared: true },
          });
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return { ok: true, staleStages: staled };
        }),
    },

    save_circuit: {
      description: `Replace the circuit schematic (Engineer > Schematic view) with realistic Wokwi parts. Same conventions as wokwi.com: parts are wokwi-* element types and wires connect named pins (e.g. LED A/C, resistor 1/2, Arduino Uno GND.1/5V/A0/13, ESP32 DevKit GND.1/VIN/D2). Lay parts out with generous spacing (~150px grid) on a 1200x800 canvas. ONLY these part types render with real graphics — use them exclusively, substituting the closest supported part for anything else (e.g. wokwi-dht22 for any climate/BME/SHT sensor, wokwi-ntc-temperature-sensor for analog temperature, wokwi-ssd1306 for small I2C displays): ${PART_TYPES.join(", ")}.`,
      inputSchema: circuitSchema,
      execute: async (doc: CircuitInput) =>
        guard(ctx, "electronics.edit", async (workspaceId) => {
          const unsupported = unsupportedWokwiTypes(doc.parts);
          if (unsupported.length > 0) {
            return {
              error: `These part types have no renderable element: ${unsupported.join(", ")}. Replace each with the closest supported type and call save_circuit again. Supported: ${PART_TYPES.join(", ")}.`,
            };
          }
          const specProblems = Object.entries(doc.models ?? {}).flatMap(([type, spec]) =>
            validatePartSpec(spec).map((problem) => `${type}: ${problem}`),
          );
          if (specProblems.length > 0) {
            return {
              error: `These part specs are not usable: ${specProblems.join("; ")}. Pin names in a spec must match the pins the wires reference.`,
            };
          }
          const data = {
            version: 2,
            parts: doc.parts,
            wires: doc.wires,
            ...(doc.models ? { models: doc.models } : {}),
          };
          await prisma.designDoc.upsert({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "CIRCUIT" } },
            create: {
              projectId,
              branchId,
              kind: "CIRCUIT",
              data: data as unknown as Prisma.InputJsonValue,
              updatedById: ctx.userId,
            },
            update: { data: data as unknown as Prisma.InputJsonValue, updatedById: ctx.userId },
          });
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          const unmodelled = buildModelIndex(normalizeCircuitDoc(data)).unmodelled;
          return {
            ok: true,
            parts: doc.parts.length,
            wires: doc.wires.length,
            staleStages: staled,
            // Parts the simulator cannot exercise yet, so the model can supply
            // internals rather than discovering the gap at the fit check.
            ...(unmodelled.length > 0 ? { partsWithoutSimulationModel: unmodelled } : {}),
          };
        }),
    },

    import_wokwi_diagram: {
      description:
        'Import a full Wokwi diagram.json (from wokwi.com or one you author) as the project\'s circuit schematic. Accepts the standard format: { version, parts: [{ type, id, top, left, attrs }], connections: [["part:PIN", "part:PIN", color, []], ...] }. Replaces the current schematic.',
      inputSchema: z.object({
        diagram: z.string().max(200_000).describe("The diagram.json contents as a JSON string"),
      }),
      execute: async ({ diagram }: { diagram: string }) =>
        guard(ctx, "electronics.edit", async (workspaceId) => {
          let parsed: WokwiDiagram;
          try {
            parsed = JSON.parse(diagram) as WokwiDiagram;
          } catch {
            return { error: "diagram is not valid JSON" };
          }
          if (!Array.isArray(parsed.parts) || parsed.parts.length === 0) {
            return { error: "diagram has no parts array" };
          }
          const doc = wokwiDiagramToDoc(parsed);
          await prisma.designDoc.upsert({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "CIRCUIT" } },
            create: {
              projectId,
              branchId,
              kind: "CIRCUIT",
              data: doc as unknown as Prisma.InputJsonValue,
              updatedById: ctx.userId,
            },
            update: { data: doc as unknown as Prisma.InputJsonValue, updatedById: ctx.userId },
          });
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          const generic = unsupportedWokwiTypes(doc.parts);
          const unmodelled = buildModelIndex(doc).unmodelled;
          return {
            ok: true,
            parts: doc.parts.length,
            wires: doc.wires.length,
            staleStages: staled,
            // Imported diagrams may use parts wokwi.com has but the element
            // library doesn't; these render as generic chips.
            ...(generic.length > 0 ? { renderedAsGenericChips: generic } : {}),
            // An imported diagram brings no internals with it: every part type
            // listed here needs a spec before firmware can be run against it.
            ...(unmodelled.length > 0 ? { partsWithoutSimulationModel: unmodelled } : {}),
          };
        }),
    },

    define_part_models: {
      description:
        "Give simulation internals to part types the simulator has no built-in model for (imported diagrams, sensors, drivers, boards outside the Wokwi primitives). Merges into the schematic's existing specs; a type already specced is replaced. Pin names must match the wires exactly. Do this for every type reported in partsWithoutSimulationModel — until then those parts are inert and check_integration cannot exercise the firmware against them.",
      inputSchema: z.object({
        models: z
          .record(z.string(), partSpecSchema)
          .describe("Keyed by part type, e.g. wokwi-dht22"),
      }),
      execute: async ({ models }: { models: Record<string, PartSpec> }) =>
        guard(ctx, "electronics.edit", async (workspaceId) => {
          const problems = Object.entries(models).flatMap(([type, spec]) =>
            validatePartSpec(spec).map((problem) => `${type}: ${problem}`),
          );
          if (problems.length > 0) return { error: `Unusable specs: ${problems.join("; ")}` };

          const existing = await prisma.designDoc.findUnique({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "CIRCUIT" } },
          });
          if (!existing?.data) return { error: "There is no schematic to attach part models to." };

          const doc = normalizeCircuitDoc(existing.data);
          const merged = { ...doc, models: { ...(doc.models ?? {}), ...models } };
          await prisma.designDoc.update({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "CIRCUIT" } },
            data: { data: merged as unknown as Prisma.InputJsonValue, updatedById: ctx.userId },
          });
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return {
            ok: true,
            modelled: Object.keys(models),
            stillUnmodelled: buildModelIndex(merged).unmodelled,
            staleStages: staled,
          };
        }),
    },

    clear_pcb: {
      description:
        "Clear the PCB layout (Engineer > PCB): remove every board and reset to a single empty one. Does not touch the schematic.",
      inputSchema: z.object({}),
      execute: async () =>
        guard(ctx, "electronics.edit", async (workspaceId) => {
          const data = emptyPcbSet();
          await prisma.designDoc.upsert({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "PCB" } },
            create: {
              projectId,
              branchId,
              kind: "PCB",
              data: data as unknown as Prisma.InputJsonValue,
              updatedById: ctx.userId,
            },
            update: { data: data as unknown as Prisma.InputJsonValue, updatedById: ctx.userId },
          });
          await recordAudit({
            type: "DesignDocUpdated",
            workspaceId,
            projectId,
            branchId,
            actorId: ctx.userId,
            actorType: "AGENT",
            payload: { kind: "PCB", cleared: true },
          });
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return { ok: true, staleStages: staled };
        }),
    },

    save_pcb: {
      description: `Replace the PCB board layout (Engineer > PCB view): rectangular Edge.Cuts outline in millimetres, footprint placement, and optionally copper routing (tracks + vias). Origin (0,0) is the top-left of the board; +X right, +Y down. Keep footprints inside the outline with ~2mm margin; put mounting holes near corners; connectors (USB, headers) on edges. Map schematic parts to footprints: resistors→R_0603/R_0805, caps→C_0603, LEDs→LED_0805, MCUs/ICs→SOIC-8 or QFN-16-3x3, pin headers→PinHeader_1x04, USB→USB_C_Receptacle, holes→MountingHole_3.2mm. Set partId (and pinMap where pin names differ) on every footprint that comes from the schematic: that derives the netlist and draws the ratsnest, and the result tells you which parts are still unplaced or unmapped. Place connected parts near each other so airwires stay short and uncrossed. ONLY these libraryIds: ${FOOTPRINT_IDS.join(", ")}.

Routing: place first, render, then route. Each track's endpoints must sit exactly on pad centres — get_project_state lists every pad's board position — because connection is decided geometrically, not by the net field. Front-side SMD pads exist only on F.Cu, so a B.Cu track cannot reach one without a via; through-hole pads (pin headers, USB-C tabs) reach both layers. Route on one layer where you can and use B.Cu with vias at both ends only to cross. The result reports routed/total connections and every DRC violation, so re-check it after each call.

Pours: a GND zone covering the board is usually the last step and removes most GND routing, since it connects every GND pad it surrounds. Draw it inset from the edge by at least the clearance, and route the signal nets first — a pour clears around whatever copper already exists.

Multiple boards: when get_project_state reports schematicBoards.regions, each region is a separate physical board. Call this once per board with its own boardId and groupId, and place only that region's parts. Nets in schematicBoards.crossings have pins on two boards, so they cannot be traces — give each board a connector footprint (PinHeader_1x04) for them; this board's ratsnest deliberately excludes them.`,
      inputSchema: pcbSchema,
      execute: async (input: PcbInput) =>
        guard(ctx, "electronics.edit", async (workspaceId) => {
          const unknown = unsupportedFootprintIds(input.footprints);
          if (unknown.length > 0) {
            return {
              error: `Unknown footprint libraryIds: ${unknown.join(", ")}. Use only: ${FOOTPRINT_IDS.join(", ")}.`,
            };
          }
          // Existing copper is kept when the model omits tracks/vias, so a
          // placement-only edit does not silently discard a routed board.
          const existing = await prisma.designDoc.findUnique({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "PCB" } },
          });
          const set = normalizePcbSet(existing?.data ?? null);
          const targetId = input.boardId ?? set.activeBoardId ?? set.boards[0]!.id!;
          const previous = set.boards.find((b) => b.id === targetId) ?? null;

          const data = normalizePcbDoc({
            version: 1,
            id: targetId,
            name: input.boardName ?? previous?.name,
            groupId: input.groupId ?? previous?.groupId,
            board: input.board,
            footprints: input.footprints,
            tracks: input.tracks ?? previous?.tracks ?? [],
            vias: input.vias ?? previous?.vias ?? [],
            zones: input.zones ?? previous?.zones ?? [],
            rules: input.rules ?? previous?.rules,
          });

          // A boardId that names no existing board adds one.
          const boards = previous
            ? set.boards.map((b) => (b.id === targetId ? data : b))
            : [...set.boards, data];
          const nextSet = { version: 2 as const, boards, activeBoardId: targetId };
          await prisma.designDoc.upsert({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "PCB" } },
            create: {
              projectId,
              branchId,
              kind: "PCB",
              data: nextSet as unknown as Prisma.InputJsonValue,
              updatedById: ctx.userId,
            },
            update: { data: nextSet as unknown as Prisma.InputJsonValue, updatedById: ctx.userId },
          });
          // Keep parts/pcb/main.kcl in sync so Assembly can import the board as a CAD part.
          await mutateModel3dDoc(projectId, branchId, ctx.userId, (base) =>
            syncPcbCadPart(base, data),
          );
          await recordAudit({
            type: "DesignDocUpdated",
            workspaceId,
            projectId,
            branchId,
            actorId: ctx.userId,
            actorType: "AGENT",
            payload: {
              kind: "PCB",
              footprints: data.footprints.length,
              board: data.board,
              cadPart: "parts/pcb/main.kcl",
            },
          });
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");

          // Report the netlist the placement produced so the model can see
          // which schematic parts it left unplaced or unmapped.
          const circuitDoc = await prisma.designDoc.findUnique({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "CIRCUIT" } },
          });
          const circuit = circuitDoc?.data
            ? normalizeCircuitDoc(circuitDoc.data)
            : { version: 2 as const, parts: [], wires: [], groups: [] };
          // Only this board's slice of the schematic: a part on a sibling board
          // is not an unplaced part here.
          const slice = circuitForGroup(circuit, data.groupId ?? null);
          const ratsnest = buildRatsnest(slice, data);
          const { nets, airwires, issues, routedCount, totalConnections } = ratsnest;
          const unresolved =
            issues.unlinkedParts.length +
            issues.unmappedPins.length +
            issues.danglingFootprints.length;
          const drc = runDrc(data, ratsnest);

          return {
            ok: true,
            boardId: data.id,
            boardName: data.name,
            boards: boards.length,
            board: data.board,
            footprints: data.footprints.length,
            cadPart: "parts/pcb/main.kcl",
            tracks: data.tracks.length,
            vias: data.vias.length,
            zones: data.zones.length,
            nets: nets.length,
            routed: `${routedCount}/${totalConnections}`,
            airwires: airwires.length,
            drc: {
              errors: drc.errorCount,
              warnings: drc.warningCount,
              // Bounded so a badly routed board cannot flood the context.
              violations: drc.violations.slice(0, 25).map((v) => ({
                rule: v.rule,
                severity: v.severity,
                message: v.message,
              })),
            },
            ...(unresolved > 0 ? { issues } : {}),
            staleStages: staled,
            ...(unresolved > 0
              ? {
                  hint: "Some schematic pins aren't on the board yet: place the missing parts, set partId, or add a pinMap for pins whose names don't match a pad. Then call render_pcb.",
                }
              : {}),
            ...(drc.errorCount > 0
              ? {
                  drcHint:
                    "Fix the DRC errors above before calling this done. A short means copper joins two different nets; unrouted means connections remain; off-board means copper left the outline.",
                }
              : {}),
          };
        }),
    },
  };
}
