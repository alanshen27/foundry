import { z } from "zod";
import { prisma, type Prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import type { Capability, Stage } from "@foundry/domain";
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
import { buildNets, buildRatsnest } from "@/lib/pcb/netlist";
import { runDrc } from "@/lib/pcb/drc";
import { circuitForGroup, partitionBoards } from "@/lib/circuit/groups";
import { boardPads } from "@/lib/pcb/geometry";
import { isPlausibleZooOpId } from "@foundry/cad";
import {
  addCadComponents,
  normalizeCadDoc,
  removeCadComponents,
  upsertCadContent,
  upsertPartScripts,
  toZooKclPath,
  fromZooKclPath,
  type CadComponentKind,
  type CadDoc,
} from "@/lib/cad/engine";
import { recordAudit } from "../audit";
import { requireProjectCapability } from "../access";
import { mutateModel3dDoc } from "../cad-doc";
import { ensureStageStarted, markDownstreamStale, setStageStatus } from "../stage-state";
import { getObjectStorage } from "../storage";
import { getCad } from "../cad";
import { mintRenderToken } from "../render-token";
import { assembleProductWithZooMcp, syncPcbCadPart } from "../assemble-product";
import { withKclProjectDir } from "../kcl-project-dir";
import { extractProductImages, screenshotRenderPage } from "./render";

/**
 * Tool set exposed to the AI copilot. Every tool runs the same capability
 * checks and audit logging as the human tRPC mutations — the model is just
 * another (fully attributed) actor. Failures are returned as strings so the
 * model can explain them instead of crashing the stream.
 */

type ToolContext = {
  userId: string;
  projectId: string;
  branchId: string;
  /** Origin of the running app (e.g. http://localhost:3000) for render tools. */
  origin: string;
};

const requirementType = z.enum([
  "FUNCTIONAL",
  "ELECTRICAL",
  "MECHANICAL",
  "SOFTWARE",
  "VISUAL",
  "MANUFACTURING",
  "COST",
  "COMPLIANCE",
  "UX",
]);
const priority = z.enum(["MUST", "SHOULD", "MAY"]);
const disciplineEnum = z.enum(["ELECTRONICS", "MECHANICAL", "SOFTWARE", "DESIGN"]);
const checkCategory = z.enum(["VISUAL", "ELECTRICAL", "MECHANICAL", "SOFTWARE", "CROSS_DOMAIN"]);
const checkSeverity = z.enum(["INFO", "MINOR", "MAJOR", "CRITICAL"]);

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

/** Base64-encodes a stored image for a multimodal tool result. */
async function imagePart(key: string) {
  const object = await getObjectStorage().get(key);
  if (!object) return null;
  return {
    type: "file" as const,
    data: { type: "data" as const, data: Buffer.from(object.body).toString("base64") },
    mediaType: object.contentType || "image/png",
  };
}

/**
 * Calls the OpenAI Images API. Tries gpt-image-2 first, then falls back to
 * older image models for accounts without access. Returns raw PNG bytes.
 */
async function generateImage(prompt: string): Promise<Uint8Array> {
  const env = getServerEnv();
  const request = async (model: string, extra: Record<string, unknown>) => {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, prompt, size: "1024x1024", n: 1, ...extra }),
    });
    const json = (await res.json()) as {
      data?: { b64_json?: string }[];
      error?: { message?: string };
    };
    if (!res.ok || !json.data?.[0]?.b64_json) {
      throw new Error(json.error?.message ?? `Image API failed (${res.status})`);
    }
    return Buffer.from(json.data[0].b64_json, "base64");
  };
  const candidates: [string, Record<string, unknown>][] = [
    ["gpt-image-2", { quality: "medium" }],
    ["gpt-image-1", { quality: "medium" }],
    ["dall-e-3", { response_format: "b64_json" }],
  ];
  let lastError: unknown;
  for (const [model, extra] of candidates) {
    try {
      return await request(model, extra);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Image generation failed");
}

/** AI SDK prompt schemas reject Date; Prisma rows include createdAt/updatedAt. */
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function summarizeForLog(value: unknown, max = 240): string {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text) return "∅";
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return String(value);
  }
}

/** Log every tool start/finish/error so worker stalls are visible in the terminal. */

export function withToolLogging<T extends Record<string, any>>(
  tools: T,
  meta?: { runId?: string },
): T {
  const prefix = meta?.runId ? `[tool run=${meta.runId}]` : "[tool]";

  const wrapped: Record<string, any> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!tool || typeof tool.execute !== "function") {
      wrapped[name] = tool;
      continue;
    }
    const execute = tool.execute.bind(tool) as (...args: unknown[]) => unknown;
    wrapped[name] = {
      ...tool,
      execute: async (...args: unknown[]) => {
        const started = Date.now();
        console.log(`${prefix} → ${name}`, summarizeForLog(args[0]));
        try {
          const result = await execute(...args);
          const ms = Date.now() - started;
          const softError =
            result &&
            typeof result === "object" &&
            "error" in result &&
            typeof (result as { error: unknown }).error === "string"
              ? (result as { error: string }).error
              : null;
          if (softError) {
            console.warn(`${prefix} ← ${name} ${ms}ms soft-error:`, softError);
          } else {
            console.log(`${prefix} ← ${name} ${ms}ms`, summarizeForLog(result));
          }
          return result;
        } catch (err) {
          console.error(`${prefix} ✖ ${name} ${Date.now() - started}ms`, err);
          throw err;
        }
      },
    };
  }
  return wrapped as T;
}

async function guard<T>(
  ctx: ToolContext,
  capability: Capability,
  fn: (workspaceId: string) => Promise<T>,
): Promise<T | { error: string }> {
  try {
    const { project } = await requireProjectCapability(ctx.userId, ctx.projectId, capability);
    return jsonSafe(await fn(project.workspaceId));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Operation failed" };
  }
}

async function touchStage(ctx: ToolContext, workspaceId: string, stage: Stage) {
  await ensureStageStarted({
    workspaceId,
    projectId: ctx.projectId,
    branchId: ctx.branchId,
    stage,
    actorId: ctx.userId,
  });
  const flagged = await markDownstreamStale({
    workspaceId,
    projectId: ctx.projectId,
    branchId: ctx.branchId,
    changedStage: stage,
    actorId: ctx.userId,
  });
  return flagged;
}

/**
 * Resolve a model-supplied component reference to a CAD component. The model
 * tends to use whichever form it saw last — bare name, name with extension, or
 * full path — so all three resolve.
 */
function findCadComponent(doc: CadDoc, key: string, kind: CadComponentKind) {
  const raw = key.trim();
  const bare = raw.replace(/\.kcl$/i, "");
  const zooKey = toZooKclPath(raw);
  const fromZoo = fromZooKclPath(raw);
  return doc.components.find((c) => {
    if (c.kind !== kind) return false;
    if (c.path === raw || c.path === zooKey || c.path === fromZoo) return true;
    if (c.name === bare || c.name === raw) return true;
    if (c.path.replace(/\.kcl$/i, "") === bare) return true;
    if (c.path.endsWith(`/${bare}.kcl`) || c.path.endsWith(`/${bare}/main.kcl`)) return true;
    if (toZooKclPath(c.path) === zooKey || fromZooKclPath(c.path) === fromZoo) return true;
    return false;
  });
}

/** Resolve a CAD file by id, path, or name (any kind). */
function findAnyCadComponent(doc: CadDoc, key: string) {
  const raw = key.trim();
  if (!raw) return undefined;
  const byId = doc.components.find((c) => c.id === raw);
  if (byId) return byId;
  for (const kind of ["part", "assembly", "instructions"] as const) {
    const hit = findCadComponent(doc, raw, kind);
    if (hit) return hit;
  }
  return undefined;
}

export function buildProjectTools(ctx: ToolContext) {
  const { projectId, branchId } = ctx;

  return {
    get_project_state: {
      description:
        "Read the full current state of the project: brief, requirements, components (BOM), circuit schematic, PCB layout, 3D model, repos, validation checks, stage statuses. Call this before making changes if you are unsure what already exists.",
      inputSchema: z.object({}),
      execute: async () =>
        guard(ctx, "project.read", async () => {
          const where = { projectId, branchId };
          const codeFiles = await prisma.codeFile.findMany({
            where,
            select: { path: true, repo: { select: { role: true } } },
            orderBy: { path: "asc" },
          });
          const [
            brief,
            requirements,
            components,
            repoLinks,
            checks,
            stageStates,
            circuit,
            pcb,
            model3d,
            design,
          ] = await Promise.all([
            prisma.projectBrief.findUnique({
              where: { projectId_branchId: { projectId, branchId } },
            }),
            prisma.requirement.findMany({ where, orderBy: { createdAt: "asc" } }),
            prisma.component.findMany({ where, orderBy: { createdAt: "asc" } }),
            prisma.repoLink.findMany({ where }),
            prisma.validationCheck.findMany({ where, orderBy: { createdAt: "asc" } }),
            prisma.stageState.findMany({ where }),
            prisma.designDoc.findUnique({
              where: { projectId_branchId_kind: { projectId, branchId, kind: "CIRCUIT" } },
            }),
            prisma.designDoc.findUnique({
              where: { projectId_branchId_kind: { projectId, branchId, kind: "PCB" } },
            }),
            prisma.designDoc.findUnique({
              where: { projectId_branchId_kind: { projectId, branchId, kind: "MODEL3D" } },
            }),
            prisma.designDoc.findUnique({
              where: { projectId_branchId_kind: { projectId, branchId, kind: "DESIGN" } },
            }),
          ]);
          const circuitDoc = circuit?.data ? normalizeCircuitDoc(circuit.data) : null;
          const designData = (design?.data as Record<string, unknown> | null) ?? {};
          const conceptImages = Array.isArray(designData.conceptImages)
            ? (designData.conceptImages as { key: string; prompt: string }[])
            : [];
          return {
            brief,
            requirements,
            components,
            repoLinks,
            validationChecks: checks,
            stages: stageStates.map((s) => ({ stage: s.stage, status: s.status })),
            circuit: circuitDoc,
            pcb: pcb?.data ? normalizePcbSet(pcb.data) : null,
            /**
             * How the schematic is split across physical boards. Regions are
             * drawn on the schematic canvas; a net listed in `crossings` has
             * pins on two boards and cannot be a trace — it needs a connector
             * on each board and a cable between them.
             */
            schematicBoards: circuitDoc
              ? (() => {
                  const p = partitionBoards(circuitDoc);
                  return {
                    regions: p.slices.map((s) => ({
                      id: s.group.id,
                      label: s.group.label,
                      parts: s.partIds,
                      internalNets: s.internalNets,
                      netsNeedingConnectors: s.crossingNets,
                    })),
                    crossings: p.crossings.map((c) => ({
                      net: c.net,
                      betweenBoards: c.groupLabels,
                    })),
                    partsOnNoBoard: p.ungroupedPartIds,
                    overlappingRegions: p.overlaps.map((o) => [o.aLabel, o.bLabel]),
                  };
                })()
              : null,
            // Every pad's board position and reachable layers. Routing needs
            // these exact coordinates: a track connects only if its endpoint
            // lands on the pad, so the model cannot guess them from the
            // footprint centre alone.
            pcbPads: pcb?.data
              ? normalizePcbSet(pcb.data).boards.flatMap((b) =>
                  boardPads(b.footprints).map((p) => ({
                    boardId: b.id,
                    refDes: p.refDes,
                    pin: p.pin,
                    xMm: Number(p.xMm.toFixed(3)),
                    yMm: Number(p.yMm.toFixed(3)),
                    layers: p.layers,
                  })),
                )
              : [],
            // Nets derived from the schematic's wires, so PCB placement can be
            // checked against them. Empty until the schematic has wires.
            netlist: circuitDoc
              ? buildNets(circuitDoc).map((net) => ({
                  name: net.name,
                  nodes: net.nodes.map((n) => `${n.partId}:${n.pin}`),
                }))
              : [],
            cad: model3d?.data
              ? (() => {
                  const d = normalizeCadDoc(model3d.data);
                  return {
                    activePath: d.components.find((c) => c.id === d.activeId)?.path ?? null,
                    script: d.script,
                    components: d.components.map((c) => ({
                      path: c.path,
                      name: c.name,
                      kind: c.kind,
                      chars: c.content.length,
                    })),
                  };
                })()
              : null,
            conceptImages: conceptImages.map((c) => ({ key: c.key, prompt: c.prompt })),
            codeFiles: codeFiles.map((f) => ({ repo: f.repo.role, path: f.path })),
          };
        }),
    },

    update_brief: {
      description:
        "Create or update the product brief (Ideate stage). Only include fields you want to set; omitted fields are left unchanged.",
      inputSchema: z.object({
        prompt: z.string().max(4000).optional().describe("One-paragraph product description"),
        intendedUse: z.string().max(2000).optional(),
        environment: z.string().max(2000).optional(),
        targetAudience: z.string().max(2000).optional(),
        budgetCents: z.number().int().nonnegative().optional(),
        dimensions: z.string().max(1000).optional(),
        performanceTargets: z.string().max(2000).optional(),
        manufacturingNotes: z.string().max(2000).optional(),
      }),
      execute: async (input: Record<string, unknown>) =>
        guard(ctx, "ideate.edit", async (workspaceId) => {
          const brief = await prisma.projectBrief.upsert({
            where: { projectId_branchId: { projectId, branchId } },
            create: { projectId, branchId, updatedById: ctx.userId, ...input },
            update: { updatedById: ctx.userId, ...input },
          });
          await recordAudit({
            type: "BriefUpdated",
            workspaceId,
            projectId,
            branchId,
            actorId: ctx.userId,
            actorType: "AGENT",
            payload: { briefId: brief.id, fields: Object.keys(input) },
          });
          const staled = await touchStage(ctx, workspaceId, "IDEATE");
          return { ok: true, staleStages: staled };
        }),
    },

    add_requirements: {
      description: "Add one or more structured requirements to the Ideate stage.",
      inputSchema: z.object({
        requirements: z
          .array(
            z.object({
              title: z.string().min(1).max(200),
              description: z.string().max(2000).optional(),
              type: requirementType.default("FUNCTIONAL"),
              priority: priority.default("SHOULD"),
              minValue: z.number().optional(),
              maxValue: z.number().optional(),
              unit: z.string().max(40).optional(),
              rationale: z.string().max(2000).optional(),
              verificationMethod: z.string().max(2000).optional(),
            }),
          )
          .min(1)
          .max(30),
      }),
      execute: async ({ requirements }: { requirements: Record<string, unknown>[] }) =>
        guard(ctx, "ideate.edit", async (workspaceId) => {
          const created = await prisma.requirement.createManyAndReturn({
            data: requirements.map((r) => ({
              projectId,
              branchId,
              createdById: ctx.userId,
              ...r,
            })) as Prisma.RequirementCreateManyInput[],
          });
          for (const r of created) {
            await recordAudit({
              type: "RequirementCreated",
              workspaceId,
              projectId,
              branchId,
              actorId: ctx.userId,
              actorType: "AGENT",
              payload: { requirementId: r.id, title: r.title },
            });
          }
          const staled = await touchStage(ctx, workspaceId, "IDEATE");
          return { ok: true, created: created.length, staleStages: staled };
        }),
    },

    add_components: {
      description:
        "Add components to the bill of materials (Engineer stage). Use the correct discipline: ELECTRONICS for electrical parts, MECHANICAL for enclosure/hardware, SOFTWARE for licensed software/services, DESIGN for finish/appearance items. Prefer real distributor/datasheet links (sourceUrl) and product image URLs (imageUrl) from web_search.",
      inputSchema: z.object({
        components: z
          .array(
            z.object({
              discipline: disciplineEnum,
              name: z.string().min(1).max(200),
              refDes: z.string().max(40).optional().describe("Reference designator, e.g. R1, U2"),
              manufacturer: z.string().max(120).optional(),
              partNumber: z.string().max(120).optional(),
              quantity: z.number().int().positive().default(1),
              unitCostCents: z.number().int().nonnegative().optional(),
              sourceUrl: z
                .string()
                .url()
                .max(500)
                .optional()
                .describe("Distributor product page or datasheet URL"),
              imageUrl: z
                .string()
                .url()
                .max(2000)
                .optional()
                .describe("Direct URL to a product photo / thumbnail"),
              notes: z.string().max(2000).optional(),
            }),
          )
          .min(1)
          .max(50),
      }),
      execute: async ({ components }: { components: Record<string, unknown>[] }) =>
        guard(ctx, "electronics.edit", async (workspaceId) => {
          const created = await prisma.component.createManyAndReturn({
            data: components.map((c) => ({
              projectId,
              branchId,
              createdById: ctx.userId,
              ...c,
            })) as Prisma.ComponentCreateManyInput[],
          });
          for (const c of created) {
            await recordAudit({
              type: "ComponentCreated",
              workspaceId,
              projectId,
              branchId,
              actorId: ctx.userId,
              actorType: "AGENT",
              payload: { componentId: c.id, name: c.name },
            });
          }
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return { ok: true, created: created.length, staleStages: staled };
        }),
    },

    remove_requirements: {
      description:
        "Delete requirements from the Ideate stage. Prefer ids from get_project_state; titleContains matches case-insensitively when ids are unknown.",
      inputSchema: z.object({
        ids: z.array(z.string()).max(50).optional(),
        titleContains: z.array(z.string().min(1).max(200)).max(20).optional(),
      }),
      execute: async ({ ids, titleContains }: { ids?: string[]; titleContains?: string[] }) =>
        guard(ctx, "ideate.edit", async (workspaceId) => {
          if ((!ids || ids.length === 0) && (!titleContains || titleContains.length === 0)) {
            return { error: "Provide ids and/or titleContains" };
          }
          const existing = await prisma.requirement.findMany({
            where: { projectId, branchId },
            select: { id: true, title: true },
          });
          const idSet = new Set(ids ?? []);
          const needles = (titleContains ?? []).map((t) => t.toLowerCase());
          const toDelete = existing.filter(
            (r) => idSet.has(r.id) || needles.some((n) => r.title.toLowerCase().includes(n)),
          );
          if (toDelete.length === 0) return { ok: true, deleted: 0 };
          await prisma.requirement.deleteMany({
            where: { id: { in: toDelete.map((r) => r.id) } },
          });
          for (const r of toDelete) {
            await recordAudit({
              type: "RequirementDeleted",
              workspaceId,
              projectId,
              branchId,
              actorId: ctx.userId,
              actorType: "AGENT",
              payload: { requirementId: r.id, title: r.title },
            });
          }
          const staled = await touchStage(ctx, workspaceId, "IDEATE");
          return { ok: true, deleted: toDelete.length, staleStages: staled };
        }),
    },

    remove_components: {
      description:
        "Delete BOM components. Prefer ids from get_project_state; nameContains / refDes match when ids are unknown.",
      inputSchema: z.object({
        ids: z.array(z.string()).max(50).optional(),
        nameContains: z.array(z.string().min(1).max(200)).max(20).optional(),
        refDes: z.array(z.string().min(1).max(40)).max(40).optional(),
      }),
      execute: async ({
        ids,
        nameContains,
        refDes,
      }: {
        ids?: string[];
        nameContains?: string[];
        refDes?: string[];
      }) =>
        guard(ctx, "electronics.edit", async (workspaceId) => {
          if (
            (!ids || ids.length === 0) &&
            (!nameContains || nameContains.length === 0) &&
            (!refDes || refDes.length === 0)
          ) {
            return { error: "Provide ids, nameContains, and/or refDes" };
          }
          const existing = await prisma.component.findMany({
            where: { projectId, branchId },
            select: { id: true, name: true, refDes: true },
          });
          const idSet = new Set(ids ?? []);
          const refs = new Set((refDes ?? []).map((r) => r.toUpperCase()));
          const needles = (nameContains ?? []).map((n) => n.toLowerCase());
          const toDelete = existing.filter(
            (c) =>
              idSet.has(c.id) ||
              (c.refDes && refs.has(c.refDes.toUpperCase())) ||
              needles.some((n) => c.name.toLowerCase().includes(n)),
          );
          if (toDelete.length === 0) return { ok: true, deleted: 0 };
          await prisma.component.deleteMany({
            where: { id: { in: toDelete.map((c) => c.id) } },
          });
          for (const c of toDelete) {
            await recordAudit({
              type: "ComponentDeleted",
              workspaceId,
              projectId,
              branchId,
              actorId: ctx.userId,
              actorType: "AGENT",
              payload: { componentId: c.id, name: c.name },
            });
          }
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return { ok: true, deleted: toDelete.length, staleStages: staled };
        }),
    },

    remove_validation_checks: {
      description:
        "Delete validation checks from Verify. Prefer ids from get_project_state; titleContains as fallback.",
      inputSchema: z.object({
        ids: z.array(z.string()).max(50).optional(),
        titleContains: z.array(z.string().min(1).max(200)).max(20).optional(),
      }),
      execute: async ({ ids, titleContains }: { ids?: string[]; titleContains?: string[] }) =>
        guard(ctx, "verification.run", async (workspaceId) => {
          if ((!ids || ids.length === 0) && (!titleContains || titleContains.length === 0)) {
            return { error: "Provide ids and/or titleContains" };
          }
          const existing = await prisma.validationCheck.findMany({
            where: { projectId, branchId },
            select: { id: true, title: true },
          });
          const idSet = new Set(ids ?? []);
          const needles = (titleContains ?? []).map((t) => t.toLowerCase());
          const toDelete = existing.filter(
            (c) => idSet.has(c.id) || needles.some((n) => c.title.toLowerCase().includes(n)),
          );
          if (toDelete.length === 0) return { ok: true, deleted: 0 };
          await prisma.validationCheck.deleteMany({
            where: { id: { in: toDelete.map((c) => c.id) } },
          });
          for (const c of toDelete) {
            await recordAudit({
              type: "ValidationCheckDeleted",
              workspaceId,
              projectId,
              branchId,
              actorId: ctx.userId,
              actorType: "AGENT",
              payload: { checkId: c.id, title: c.title },
            });
          }
          return { ok: true, deleted: toDelete.length };
        }),
    },

    delete_code_file: {
      description: "Delete a file from the project's code workspace (Engineer > Code).",
      inputSchema: z.object({
        path: z.string().min(1).max(300).describe("Repo-relative path, e.g. src/main.cpp"),
        repoRole: z.string().max(80).optional(),
      }),
      execute: async ({ path, repoRole }: { path: string; repoRole?: string }) =>
        guard(ctx, "software.edit", async (workspaceId) => {
          if (path.includes("..") || path.startsWith("/")) {
            return { error: "Invalid path" };
          }
          const repo = await prisma.repoLink.findFirst({
            where: { projectId, branchId, ...(repoRole ? { role: repoRole } : {}) },
            orderBy: { createdAt: "asc" },
          });
          if (!repo) return { error: "No linked repository" };
          const existing = await prisma.codeFile.findUnique({
            where: { repoId_path: { repoId: repo.id, path } },
          });
          if (!existing) return { ok: true, deleted: 0 };
          await prisma.codeFile.delete({ where: { id: existing.id } });
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return { ok: true, deleted: 1, path, staleStages: staled };
        }),
    },

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

    extract_product_images: {
      description:
        "Open a distributor/product page and extract candidate product photos (og:image, JSON-LD, large images). Use before add_components to fill imageUrl with a real thumbnail.",
      inputSchema: z.object({
        url: z.string().url().max(2000).describe("Product or distributor page URL"),
        limit: z.number().int().min(1).max(12).default(6),
      }),
      execute: async ({ url, limit }: { url: string; limit?: number }) =>
        guard(ctx, "project.read", async () => {
          try {
            const images = await extractProductImages(url, { limit: limit ?? 6 });
            return {
              ok: true,
              url,
              images,
              hint: images[0]
                ? `Use images[0].url as imageUrl on add_components (${images[0].source}).`
                : "No usable images found — try another product URL.",
            };
          } catch (err) {
            return { error: err instanceof Error ? err.message : "Image extraction failed" };
          }
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
          const data = { version: 2, parts: doc.parts, wires: doc.wires };
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
          return {
            ok: true,
            parts: doc.parts.length,
            wires: doc.wires.length,
            staleStages: staled,
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
          return {
            ok: true,
            parts: doc.parts.length,
            wires: doc.wires.length,
            staleStages: staled,
            // Imported diagrams may use parts wokwi.com has but the element
            // library doesn't; these render as generic chips.
            ...(generic.length > 0 ? { renderedAsGenericChips: generic } : {}),
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

    create_cad_component: {
      description:
        "Add one or more components to Engineer > Model in a single call (parts, assembly KCL, or instructions markdown). Prefer one batched call with components:[…] over many parallel calls — same result, fewer round trips. Assembly kind ALWAYS creates/updates assembly/product.kcl (never another assembly path).",
      inputSchema: z
        .object({
          name: z.string().min(1).max(64).optional(),
          kind: z.enum(["part", "assembly", "instructions"]).optional(),
          content: z.string().max(40_000).optional(),
          components: z
            .array(
              z.object({
                name: z.string().min(1).max(64),
                kind: z.enum(["part", "assembly", "instructions"]),
                content: z.string().max(40_000).optional(),
              }),
            )
            .min(1)
            .max(20)
            .optional(),
        })
        .refine((v) => Boolean(v.components?.length || (v.name && v.kind)), {
          message: "Provide components[] or name+kind",
        }),
      execute: async (input: {
        name?: string;
        kind?: "part" | "assembly" | "instructions";
        content?: string;
        components?: {
          name: string;
          kind: "part" | "assembly" | "instructions";
          content?: string;
        }[];
      }) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          const items =
            input.components ??
            (input.name && input.kind
              ? [{ name: input.name, kind: input.kind, content: input.content }]
              : []);
          const beforePaths = new Set<string>();
          const data = await mutateModel3dDoc(projectId, branchId, ctx.userId, (base) => {
            for (const c of base.components) beforePaths.add(c.path);
            return addCadComponents(base, items);
          });
          const created = data.components.filter((c) => !beforePaths.has(c.path));
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return {
            ok: true,
            created: created.map((c) => ({ path: c.path, kind: c.kind, name: c.name })),
            paths: data.components.map((c) => c.path),
            staleStages: staled,
          };
        }),
    },

    delete_cad_component: {
      description:
        "Delete CAD files from Engineer > Model (parts/*.kcl, assembly/*.kcl, docs/*.md). Prefer paths or ids from get_project_state.cad.components. Use when the user asks to remove a part, scrap a failed generation, or clear an assembly file. After deleting parts referenced by assembly/product.kcl, call add_part_to_assembly again if the assembly should still exist.",
      inputSchema: z.object({
        paths: z
          .array(z.string().min(1).max(200))
          .max(40)
          .optional()
          .describe("Paths or names, e.g. parts/lid.kcl, lid, assembly/product.kcl"),
        ids: z.array(z.string()).max(40).optional().describe("Component ids from get_project_state"),
        nameContains: z
          .array(z.string().min(1).max(200))
          .max(20)
          .optional()
          .describe("Case-insensitive name substring match when path/id is unknown"),
      }),
      execute: async ({
        paths,
        ids,
        nameContains,
      }: {
        paths?: string[];
        ids?: string[];
        nameContains?: string[];
      }) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          if (
            (!paths || paths.length === 0) &&
            (!ids || ids.length === 0) &&
            (!nameContains || nameContains.length === 0)
          ) {
            return { error: "Provide paths, ids, and/or nameContains" };
          }
          const idSet = new Set(ids ?? []);
          const needles = (nameContains ?? []).map((n) => n.toLowerCase());
          const pathKeys = paths ?? [];
          let deleted: { id: string; path: string; kind: string; name: string }[] = [];
          const data = await mutateModel3dDoc(projectId, branchId, ctx.userId, (base) => {
            const toDrop = new Set<string>();
            for (const c of base.components) {
              if (idSet.has(c.id)) toDrop.add(c.id);
              else if (needles.some((n) => c.name.toLowerCase().includes(n))) toDrop.add(c.id);
            }
            for (const key of pathKeys) {
              const hit = findAnyCadComponent(base, key);
              if (hit) toDrop.add(hit.id);
            }
            deleted = base.components
              .filter((c) => toDrop.has(c.id))
              .map((c) => ({ id: c.id, path: c.path, kind: c.kind, name: c.name }));
            return removeCadComponents(base, toDrop);
          });
          if (deleted.length === 0) {
            return {
              ok: true,
              deleted: 0,
              paths: data.components.map((c) => c.path),
              hint: "No matching CAD components. Call get_project_state and check cad.components.",
            };
          }
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return {
            ok: true,
            deleted: deleted.length,
            removed: deleted,
            paths: data.components.map((c) => c.path),
            staleStages: staled,
          };
        }),
    },

    text_to_cad: {
      description:
        "Generate parametric KCL parts via Zoo Zookeeper (Agent API) and save them into the CAD workspace (parts/*). Prefer this for new geometry. To model several independent parts (enclosure + lid + bracket), pass parts:[{partName,prompt}…] — they generate concurrently and each lands in its own file, which is much faster than one call per part. Single-part form: prompt + optional partName (defaults to parts/main.kcl). Each generation can take several minutes. After success, call render_model_views. NEVER invent zooOpId — omit it for new jobs; only pass a zooOpId copied exactly from a prior tool error (legacy REST resume). Fall back to save_cad_script only if Zoo failed.",
      inputSchema: z
        .object({
          prompt: z
            .string()
            .min(10)
            .max(4000)
            .optional()
            .describe(
              "Detailed mechanical description of the part to generate (mm). Required for new jobs.",
            ),
          partName: z
            .string()
            .min(1)
            .max(64)
            .optional()
            .describe("Part name or path (e.g. enclosure or parts/lid.kcl). Defaults to main."),
          parts: z
            .array(
              z.object({
                partName: z
                  .string()
                  .min(1)
                  .max(64)
                  .describe("Part name or path — must be unique within the call."),
                prompt: z
                  .string()
                  .min(10)
                  .max(4000)
                  .describe("Detailed mechanical description of this part (mm)."),
              }),
            )
            .min(1)
            .max(6)
            .optional()
            .describe(
              "Independent parts to generate concurrently. Use when no part's geometry depends on another's output.",
            ),
          zooOpId: z
            .string()
            .uuid()
            .optional()
            .describe(
              "ONLY a Zoo op id from a previous text_to_cad timeout/cancel error. Never invent placeholders like 1111…/4444…. Omit for new generation. Single-part form only.",
            ),
        })
        .refine((v) => Boolean(v.parts?.length || v.zooOpId || v.prompt), {
          message: "Provide parts[], prompt, or zooOpId",
        }),
      execute: async (
        input: {
          prompt?: string;
          partName?: string;
          parts?: { partName: string; prompt: string }[];
          zooOpId?: string;
        },
        { abortSignal }: { abortSignal?: AbortSignal },
      ) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          let cad;
          try {
            cad = getCad();
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
          }

          const { zooOpId } = input;
          const resumeId = zooOpId && isPlausibleZooOpId(zooOpId) ? zooOpId : undefined;
          if (zooOpId && !resumeId) {
            console.warn(`[tool text_to_cad] ignoring invented zooOpId=${zooOpId}`);
          }

          const jobs: { partName?: string; prompt: string }[] = input.parts?.length
            ? input.parts
            : [{ partName: input.partName, prompt: input.prompt ?? "" }];

          // Zoo jobs are independent HTTP operations, so fan them out and wait
          // once instead of paying the queue+poll latency per part.
          const outcomes = await Promise.all(
            jobs.map(async (job) => {
              const result = await cad.textToCad(job.prompt, {
                projectName: projectId,
                signal: abortSignal,
                // Resume only applies to the single-part form.
                existingOpId: jobs.length === 1 ? resumeId : undefined,
              });
              return { job, result };
            }),
          );

          const generated: { partName?: string; script: string }[] = [];
          const succeeded: { partName?: string; operationId: string; kclChars: number }[] = [];
          const failed: { partName?: string; error: string; zooOpId?: string; hint?: string }[] =
            [];

          for (const { job, result } of outcomes) {
            if (!result.ok) {
              const fromErr = /zooOpId=([0-9a-f-]{36})/i.exec(result.error)?.[1];
              const realFromErr = fromErr && isPlausibleZooOpId(fromErr) ? fromErr : undefined;
              failed.push({
                partName: job.partName,
                error: result.error,
                ...(realFromErr ? { zooOpId: realFromErr } : {}),
                ...(/ObjectNotFound|status=404|invent/i.test(result.error)
                  ? {
                      hint: "Call text_to_cad again with only prompt (no zooOpId) to start a new Zoo job.",
                    }
                  : {}),
              });
              continue;
            }
            if (!result.data.kcl.trim()) {
              failed.push({
                partName: job.partName,
                error: "Zoo returned empty KCL — retry with a simpler prompt",
              });
              continue;
            }
            generated.push({ partName: job.partName, script: result.data.kcl });
            succeeded.push({
              partName: job.partName,
              operationId: result.data.id,
              kclChars: result.data.kcl.length,
            });
          }

          if (generated.length === 0) {
            const first = failed[0];
            return {
              error: failed.map((f) => `${f.partName ?? "main"}: ${f.error}`).join("; "),
              ...(first?.zooOpId ? { zooOpId: first.zooOpId } : {}),
              ...(first?.hint ? { hint: first.hint } : {}),
            };
          }

          // One locked read-modify-write for every generated part, so parallel
          // results can't overwrite each other.
          const data = await mutateModel3dDoc(projectId, branchId, ctx.userId, (base) =>
            upsertPartScripts(base, generated),
          );
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          const active = data.components.find((c) => c.id === data.activeId);
          const pathOf = (partName?: string) => {
            const key = partName?.trim();
            if (!key) return "parts/main.kcl";
            return (
              data.components.find(
                (c) =>
                  c.kind === "part" &&
                  (c.path === key || c.name === key || c.path.endsWith(`/${key}.kcl`)),
              )?.path ?? key
            );
          };

          return {
            ok: true,
            engine: "zoo",
            generated: succeeded.length,
            parts: succeeded.map((part) => ({ ...part, path: pathOf(part.partName) })),
            ...(failed.length > 0 ? { failed } : {}),
            operationId: succeeded[0]?.operationId,
            path: active?.path,
            kclChars: succeeded.reduce((sum, part) => sum + part.kclChars, 0),
            staleStages: staled,
            hint:
              failed.length > 0
                ? "Some parts failed — retry those with a shorter prompt or save_cad_script, then render_model_views."
                : "Call render_model_views to inspect, or save_cad_script / create_cad_component for more parts.",
          };
        }),
    },

    save_cad_script: {
      description:
        "Write Zoo KCL (or instructions markdown) into the CAD workspace. Millimetres for KCL. Prefer text_to_cad for brand-new parts; use this to patch. Pass partName/path for non-main components (e.g. lid, docs/assembly-instructions.md). Assembly content MUST use path assembly/product.kcl (any other assembly/* path is rewritten there). Declare key dimensions as top-level bindings (`width = 60`) for visual controls.",
      inputSchema: z.object({
        script: z.string().min(8).max(40_000).describe("KCL or markdown source"),
        partName: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe("Component name or path (default parts/main.kcl)."),
      }),
      execute: async ({ script, partName }: { script: string; partName?: string }) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          const data = await mutateModel3dDoc(projectId, branchId, ctx.userId, (base) =>
            upsertCadContent(base, partName, script),
          );
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return {
            ok: true,
            engine: "zoo",
            path: data.components.find((c) => c.id === data.activeId)?.path,
            kclChars: script.length,
            staleStages: staled,
            hint: "Call render_model_views to inspect the result from multiple angles.",
          };
        }),
    },

    add_part_to_assembly: {
      description:
        "Compose assembly/product.kcl (the ONLY valid assembly path) from existing parts via Zoo Zookeeper (Agent API WebSocket — attaches prior part KCL so Zoo reuses them), then validates with Zoo MCP execute_kcl. Includes parts/pcb when a PCB exists. Engineer > Assembly renders assembly/product.kcl only. Use whenever the user asks to combine/assemble existing parts. Do NOT smash parts into one script or invent poses with save_cad_script.",
      inputSchema: z.object({
        parts: z
          .array(z.string().min(1).max(128))
          .min(1)
          .max(20)
          .describe("Names or paths of existing parts, e.g. enclosure or parts/lid.kcl"),
        includePcb: z
          .boolean()
          .optional()
          .default(true)
          .describe("Include the PCB board (parts/pcb.kcl) in the assembly when a PCB doc exists."),
        prompt: z
          .string()
          .min(8)
          .max(4000)
          .optional()
          .describe(
            "Optional product-assembly intent for Zoo (how parts mate / orient). Omit for the default assemble prompt.",
          ),
      }),
      execute: async ({
        parts,
        includePcb,
        prompt,
      }: {
        parts: string[];
        includePcb?: boolean;
        prompt?: string;
      }) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          let cad;
          try {
            cad = getCad();
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
          }

          const modelRow = await prisma.designDoc.findUnique({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "MODEL3D" } },
          });
          const base = normalizeCadDoc(modelRow?.data ?? null);
          const target =
            base.components.find(
              (c) => c.kind === "assembly" && c.path === "assembly/product.kcl",
            ) ?? base.components.find((c) => c.kind === "assembly");
          if (!target) {
            return {
              error:
                "The CAD workspace has no assembly/product.kcl yet. Create it with create_cad_component({ name: 'product', kind: 'assembly' }).",
            };
          }

          const resolvedParts = [];
          const missing: string[] = [];
          for (const key of parts) {
            const part = findCadComponent(base, key, "part");
            if (!part) missing.push(key);
            else resolvedParts.push(part);
          }
          if (resolvedParts.length === 0) {
            return {
              error: `No matching parts. Missing: ${missing.join(", ") || "(none)"}. Call get_project_state for paths.`,
            };
          }

          let pcb = null;
          if (includePcb !== false) {
            const pcbRow = await prisma.designDoc.findUnique({
              where: { projectId_branchId_kind: { projectId, branchId, kind: "PCB" } },
            });
            if (pcbRow?.data) pcb = normalizePcbDoc(pcbRow.data);
          }

          let assembled;
          try {
            assembled = await assembleProductWithZooMcp({
              cad,
              doc: base,
              assembly: target,
              parts: resolvedParts,
              pcb,
              prompt,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const sourceRangeBug = /source range out of bounds/i.test(message);
            return {
              error: message,
              hint: sourceRangeBug
                ? "This was a Zoo source_ranges client bug (trailing newline), not bad part KCL. Do NOT pad the assembly scaffold with save_cad_script or isolate parts — call add_part_to_assembly once more after deploy, or tell the user to retry. Never invent poses."
                : "Fix part KCL (or PCB), then retry add_part_to_assembly once. Do not invent assembly poses with save_cad_script, and do not pad the assembly file to chase source-map errors.",
              retryable: !sourceRangeBug,
            };
          }

          await mutateModel3dDoc(projectId, branchId, ctx.userId, () => assembled.doc);
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return {
            ok: true,
            assembly: assembled.assemblyPath,
            placed: assembled.placed,
            zooOpId: assembled.zooOpId,
            zooExecute: assembled.executeMessage,
            ...(assembled.warnings.length ? { warnings: assembled.warnings } : {}),
            ...(missing.length ? { missing } : {}),
            staleStages: staled,
            hint: "Call render_model_views to inspect the Zoo-validated assembly.",
          };
        }),
    },

    generate_concept_image: {
      description:
        "Generate a product concept image (industrial-design rendering) from a text description and attach it to the project's Design references. Do this BEFORE 3D modelling and use the image as the visual reference for text_to_cad. Also useful for exploring aesthetics with the user.",
      inputSchema: z.object({
        prompt: z
          .string()
          .min(10)
          .max(2500)
          .describe(
            "Detailed visual description: product, form factor, materials, colorway, background. Ask for a clean studio render.",
          ),
      }),
      execute: async ({ prompt }: { prompt: string }) =>
        guard(ctx, "site.edit", async (workspaceId) => {
          let png: Uint8Array;
          try {
            png = await generateImage(prompt);
          } catch (err) {
            return { error: err instanceof Error ? err.message : "Image generation failed" };
          }
          const key = `projects/${projectId}/ai/concept-${Date.now()}.png`;
          await getObjectStorage().put(key, png, "image/png");

          // Attach to the DESIGN doc so the Design tab shows references.
          const existing = await prisma.designDoc.findUnique({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "DESIGN" } },
          });
          const data = (existing?.data as Record<string, unknown> | null) ?? {};
          const conceptImages = Array.isArray(data.conceptImages) ? data.conceptImages : [];
          const nextData = {
            ...data,
            conceptImages: [...conceptImages, { key, prompt, createdAt: new Date().toISOString() }],
          };
          await prisma.designDoc.upsert({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "DESIGN" } },
            create: {
              projectId,
              branchId,
              kind: "DESIGN",
              data: nextData as Prisma.InputJsonValue,
              updatedById: ctx.userId,
            },
            update: { data: nextData as Prisma.InputJsonValue, updatedById: ctx.userId },
          });
          await recordAudit({
            type: "DesignDocUpdated",
            workspaceId,
            projectId,
            branchId,
            actorId: ctx.userId,
            actorType: "AGENT",
            payload: { kind: "DESIGN", conceptImage: key },
          });
          return { ok: true, key, imageUrl: `/api/files/${key}`, prompt };
        }),
      toModelOutput: async ({ output }: { output: unknown }) => {
        const out = output as { key?: string; error?: string };
        if (!out?.key) {
          return { type: "error-text" as const, value: out?.error ?? "Image generation failed" };
        }
        const image = await imagePart(out.key);
        return {
          type: "content" as const,
          value: [
            {
              type: "text" as const,
              text: "Concept image generated — use it as the design reference:",
            },
            ...(image ? [image] : []),
          ],
        };
      },
    },

    render_model_views: {
      description:
        "Screenshot the current 3D model / product assembly from multiple camera angles and look at the results. Prefers Zoo MCP multiview for the product assembly (real engine execute); falls back to the headless viewport which WAITS until the model has painted. Use after text_to_cad, add_part_to_assembly, or save_cad_script.",
      inputSchema: z.object({
        views: z
          .array(z.enum(["iso", "front", "top", "right"]))
          .min(1)
          .max(4)
          .default(["iso", "front", "top", "right"]),
      }),
      execute: async ({ views }: { views: ("iso" | "front" | "top" | "right")[] }) =>
        guard(ctx, "project.read", async () => {
          const storage = getObjectStorage();

          // Prefer Zoo MCP multiview — executes KCL on Zoo and returns a real collage.
          try {
            const cad = getCad();
            const modelRow = await prisma.designDoc.findUnique({
              where: { projectId_branchId_kind: { projectId, branchId, kind: "MODEL3D" } },
            });
            const doc = normalizeCadDoc(modelRow?.data ?? null);
            const assembly =
              doc.components.find(
                (c) => c.kind === "assembly" && c.path === "assembly/product.kcl",
              ) ?? doc.components.find((c) => c.kind === "assembly");
            const entry =
              assembly ?? doc.components.find((c) => c.kind === "part" && c.content.trim()) ?? null;

            if (entry) {
              const snap = await withKclProjectDir(doc, entry.path, (projectDir) =>
                cad.multiviewSnapshotKcl({ projectDir }),
              );
              if (snap.ok) {
                const key = `projects/${projectId}/ai/model-multiview-${Date.now()}.jpg`;
                await storage.put(key, new Uint8Array(snap.data.jpeg), "image/jpeg");
                return {
                  ok: true,
                  source: "zoo-mcp",
                  images: [
                    {
                      view: "multiview",
                      key,
                      imageUrl: `/api/files/${key}`,
                      layout: "front | right / top | iso",
                    },
                  ],
                };
              }
              console.warn("[render_model_views] Zoo MCP snapshot failed:", snap.error);
            }
          } catch (err) {
            console.warn(
              "[render_model_views] Zoo MCP unavailable, falling back to viewport:",
              err instanceof Error ? err.message : err,
            );
          }

          const token = mintRenderToken({ projectId, branchId, kind: "model3d" });
          try {
            // Serial views — parallel Zoo WebRTC cold-starts routinely time out
            // as "Connecting…". Cap the fallback at 2 views × 45s so one
            // inspect can't burn many minutes of Playwright on a small dyno;
            // the MCP path above returns all four angles in one collage.
            const fallbackViews = views.slice(0, 2);
            const images: { view: string; key: string; imageUrl: string }[] = [];
            for (const view of fallbackViews) {
              const url = `${ctx.origin}/render/model3d?token=${encodeURIComponent(token)}&view=${view}`;
              const png = await screenshotRenderPage(url, {
                width: 640,
                height: 480,
                readyTimeout: 45_000,
                requireReady: true,
              });
              const key = `projects/${projectId}/ai/model-${view}-${Date.now()}.png`;
              await storage.put(key, new Uint8Array(png), "image/png");
              images.push({ view, key, imageUrl: `/api/files/${key}` });
            }
            return { ok: true, source: "viewport", images };
          } catch (err) {
            return {
              error: `Rendering failed: ${err instanceof Error ? err.message : String(err)}. If the browser is missing, run: pnpm exec playwright install chromium`,
            };
          }
        }),
      toModelOutput: async ({ output }: { output: unknown }) => {
        const out = output as { images?: { view: string; key: string }[]; error?: string };
        if (!out?.images) {
          return { type: "error-text" as const, value: out?.error ?? "Rendering failed" };
        }
        const value: (
          { type: "text"; text: string } | NonNullable<Awaited<ReturnType<typeof imagePart>>>
        )[] = [];
        for (const image of out.images) {
          const part = await imagePart(image.key);
          value.push({ type: "text" as const, text: `${image.view} view:` });
          if (part) value.push(part);
        }
        return { type: "content" as const, value };
      },
    },

    render_circuit: {
      description:
        "Screenshot the current circuit schematic and look at it. Use after save_circuit or import_wokwi_diagram to check part placement, overlaps, and wiring — then fix and re-render.",
      inputSchema: z.object({}),
      execute: async () =>
        guard(ctx, "project.read", async () => {
          const token = mintRenderToken({ projectId, branchId, kind: "circuit" });
          try {
            const url = `${ctx.origin}/render/circuit?token=${encodeURIComponent(token)}`;
            const png = await screenshotRenderPage(url, {
              width: 1024,
              height: 720,
              readyTimeout: 60_000,
              requireReady: true,
            });
            const key = `projects/${projectId}/ai/circuit-${Date.now()}.png`;
            await getObjectStorage().put(key, new Uint8Array(png), "image/png");
            return { ok: true, key, imageUrl: `/api/files/${key}` };
          } catch (err) {
            return {
              error: `Rendering failed: ${err instanceof Error ? err.message : String(err)}. If the browser is missing, run: pnpm exec playwright install chromium`,
            };
          }
        }),
      toModelOutput: async ({ output }: { output: unknown }) => {
        const out = output as { key?: string; error?: string };
        if (!out?.key) {
          return { type: "error-text" as const, value: out?.error ?? "Rendering failed" };
        }
        const image = await imagePart(out.key);
        return {
          type: "content" as const,
          value: [{ type: "text" as const, text: "Current schematic:" }, ...(image ? [image] : [])],
        };
      },
    },

    render_pcb: {
      description:
        "Screenshot the current PCB board layout and look at it. Use after save_pcb to check outline size, footprint overlaps, edge clearance, and connector placement — then fix and re-render.",
      inputSchema: z.object({}),
      execute: async () =>
        guard(ctx, "project.read", async () => {
          const token = mintRenderToken({ projectId, branchId, kind: "pcb" });
          try {
            const url = `${ctx.origin}/render/pcb?token=${encodeURIComponent(token)}`;
            const png = await screenshotRenderPage(url, {
              width: 1024,
              height: 720,
              readyTimeout: 60_000,
              requireReady: true,
            });
            const key = `projects/${projectId}/ai/pcb-${Date.now()}.png`;
            await getObjectStorage().put(key, new Uint8Array(png), "image/png");
            return { ok: true, key, imageUrl: `/api/files/${key}` };
          } catch (err) {
            return {
              error: `Rendering failed: ${err instanceof Error ? err.message : String(err)}. If the browser is missing, run: pnpm exec playwright install chromium`,
            };
          }
        }),
      toModelOutput: async ({ output }: { output: unknown }) => {
        const out = output as { key?: string; error?: string };
        if (!out?.key) {
          return { type: "error-text" as const, value: out?.error ?? "Rendering failed" };
        }
        const image = await imagePart(out.key);
        return {
          type: "content" as const,
          value: [
            { type: "text" as const, text: "Current PCB layout:" },
            ...(image ? [image] : []),
          ],
        };
      },
    },

    add_repo_link: {
      description: "Link a source repository (Engineer > Code tab), e.g. firmware or app code.",
      inputSchema: z.object({
        role: z.string().min(1).max(80).describe("e.g. firmware, mobile-app, tooling"),
        url: z.string().url().max(500),
        notes: z.string().max(1000).optional(),
      }),
      execute: async (input: { role: string; url: string; notes?: string }) =>
        guard(ctx, "github.connect", async (workspaceId) => {
          const repo = await prisma.repoLink.create({
            data: { projectId, branchId, createdById: ctx.userId, ...input },
          });
          await recordAudit({
            type: "RepoLinkCreated",
            workspaceId,
            projectId,
            branchId,
            actorId: ctx.userId,
            actorType: "AGENT",
            payload: { repoLinkId: repo.id, url: repo.url },
          });
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return { ok: true, staleStages: staled };
        }),
    },

    add_validation_checks: {
      description:
        "Add validation checks to the Verify stage checklist. Derive them from the requirements (each MUST requirement should have at least one check).",
      inputSchema: z.object({
        checks: z
          .array(
            z.object({
              category: checkCategory.default("CROSS_DOMAIN"),
              title: z.string().min(1).max(200),
              detail: z.string().max(2000).optional(),
              severity: checkSeverity.default("INFO"),
            }),
          )
          .min(1)
          .max(40),
      }),
      execute: async ({ checks }: { checks: Record<string, unknown>[] }) =>
        guard(ctx, "verification.run", async (workspaceId) => {
          const created = await prisma.validationCheck.createManyAndReturn({
            data: checks.map((c) => ({
              projectId,
              branchId,
              createdById: ctx.userId,
              ...c,
            })) as Prisma.ValidationCheckCreateManyInput[],
          });
          for (const c of created) {
            await recordAudit({
              type: "ValidationCheckCreated",
              workspaceId,
              projectId,
              branchId,
              actorId: ctx.userId,
              actorType: "AGENT",
              payload: { checkId: c.id, title: c.title },
            });
          }
          await ensureStageStarted({
            workspaceId,
            projectId,
            branchId,
            stage: "VERIFY",
            actorId: ctx.userId,
          });
          return { ok: true, created: created.length };
        }),
    },

    write_code_file: {
      description:
        "Create or overwrite a file in the project's code workspace (Engineer > Code tab). Files belong to a linked repository; if none is linked yet, one is created automatically with role 'firmware'. Use for firmware, configs, or app scaffolding.",
      inputSchema: z.object({
        path: z.string().min(1).max(300).describe("Repo-relative path, e.g. src/main.cpp"),
        content: z.string().max(200_000),
        repoRole: z
          .string()
          .max(80)
          .optional()
          .describe(
            "Which linked repo to write into (matches the repo's role); defaults to the first repo",
          ),
      }),
      execute: async ({
        path,
        content,
        repoRole,
      }: {
        path: string;
        content: string;
        repoRole?: string;
      }) =>
        guard(ctx, "software.edit", async (workspaceId) => {
          if (path.includes("..") || path.startsWith("/")) {
            return { error: "Invalid path" };
          }
          let repo = await prisma.repoLink.findFirst({
            where: { projectId, branchId, ...(repoRole ? { role: repoRole } : {}) },
            orderBy: { createdAt: "asc" },
          });
          repo ??= await prisma.repoLink.create({
            data: {
              projectId,
              branchId,
              role: repoRole ?? "firmware",
              url: "https://github.com/link-me/placeholder",
              notes: "Created by copilot — replace with the real repository URL",
              createdById: ctx.userId,
            },
          });
          await prisma.codeFile.upsert({
            where: { repoId_path: { repoId: repo.id, path } },
            create: {
              projectId,
              branchId,
              repoId: repo.id,
              path,
              content,
              updatedById: ctx.userId,
            },
            update: { content, updatedById: ctx.userId },
          });
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return { ok: true, repo: repo.role, path, bytes: content.length, staleStages: staled };
        }),
    },

    request_review: {
      description:
        "Mark a stage as NEEDS_REVIEW so a human reviews it, e.g. after you made significant changes or detected divergence between stages. Include a short reason.",
      inputSchema: z.object({
        stage: z.enum(["IDEATE", "ENGINEER", "VERIFY", "LAUNCH"]),
        reason: z.string().min(1).max(500),
      }),
      execute: async ({ stage, reason }: { stage: Stage; reason: string }) =>
        guard(ctx, "project.read", async (workspaceId) => {
          const moved = await setStageStatus({
            workspaceId,
            projectId,
            branchId,
            stage,
            to: "NEEDS_REVIEW",
            actorId: ctx.userId,
          });
          return moved
            ? { ok: true, reason }
            : { ok: false, note: "Stage cannot move to NEEDS_REVIEW from its current status" };
        }),
    },
  };
}
