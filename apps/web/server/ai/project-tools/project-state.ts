/**
 * Copilot tools: brief, requirements, BOM, repository links and review requests.
 */

import { z } from "zod";
import { prisma, type Prisma } from "@foundry/db";
import type { Stage } from "@foundry/domain";
import { normalizeCircuitDoc } from "@/lib/circuit/catalog";
import { normalizePcbSet } from "@/lib/pcb/doc";
import { buildNets } from "@/lib/pcb/netlist";
import { partitionBoards } from "@/lib/circuit/groups";
import { boardPads } from "@/lib/pcb/geometry";
import { normalizeCadDoc } from "@/lib/cad/engine";
import { recordAudit } from "../../audit";
import { setStageStatus } from "../../stage-state";
import { extractProductImages } from "../render";
import { type ToolContext, type ToolKit, guard, touchStage } from "./shared";

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

/** Brief, requirements, BOM, repository links and review requests. */
export function buildProjectStateTools(ctx: ToolContext, _kit: ToolKit) {
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
                  boardPads(b.footprints, b.library).map((p) => ({
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

    extract_product_images: {
      description:
        "Open a distributor/product page and extract candidate product photos (og:image, JSON-LD, large images). Use before add_components to fill imageUrl with a real thumbnail.",
      inputSchema: z.object({
        url: z.string().url().max(2000).describe("Product or distributor page URL"),
        limit: z.number().int().min(1).max(12).default(6),
      }),
      execute: async (
        { url, limit }: { url: string; limit?: number },
        { abortSignal }: { abortSignal?: AbortSignal } = {},
      ) =>
        guard(ctx, "project.read", async () => {
          try {
            const { images, via, problem } = await extractProductImages(url, {
              limit: limit ?? 6,
              signal: abortSignal,
            });
            const hint = images[0]
              ? `Use images[0].url as imageUrl on add_components (${images[0].source}).`
              : problem === "blocked"
                ? "This distributor served an anti-bot page — try another distributor's URL for the same part."
                : problem === "browser-unavailable"
                  ? "The page could not be read this time — try another product URL, or add the component without imageUrl."
                  : "No usable images found — try another product URL.";
            return { ok: true, url, images, via, ...(problem ? { problem } : {}), hint };
          } catch (err) {
            return { error: err instanceof Error ? err.message : "Image extraction failed" };
          }
        }),
    },

    add_repo_link: {
      description: "Link a source repository (Engineer > Repository), e.g. firmware or app code.",
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
