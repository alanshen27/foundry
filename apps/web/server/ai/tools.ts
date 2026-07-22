import { z } from "zod";
import { prisma, type Prisma } from "@foundry/db";
import type { Capability, Stage } from "@foundry/domain";
import { recordAudit } from "../audit";
import { requireProjectCapability } from "../access";
import { ensureStageStarted, markDownstreamStale, setStageStatus } from "../stage-state";

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
  components: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum([
          "resistor",
          "capacitor",
          "led",
          "diode",
          "ic",
          "mcu",
          "battery",
          "switch",
          "connector",
          "sensor",
          "ground",
        ]),
        label: z.string(),
        value: z.string().optional(),
        x: z.number(),
        y: z.number(),
        rotation: z.number().default(0),
      }),
    )
    .max(100),
  wires: z
    .array(
      z.object({
        id: z.string(),
        from: z.object({ component: z.string(), pin: z.number().int().min(0) }),
        to: z.object({ component: z.string(), pin: z.number().int().min(0) }),
      }),
    )
    .max(200),
});

const model3dSchema = z.object({
  parts: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        primitive: z.enum(["box", "cylinder", "sphere"]),
        // millimetres; box uses all three, cylinder [radius, height], sphere [radius]
        size: z.array(z.number().positive()).min(1).max(3),
        position: z.tuple([z.number(), z.number(), z.number()]),
        rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
        color: z.string().default("#8899aa"),
      }),
    )
    .max(60),
});

export type CircuitDoc = z.infer<typeof circuitSchema>;
export type Model3dDoc = z.infer<typeof model3dSchema>;

async function guard<T>(
  ctx: ToolContext,
  capability: Capability,
  fn: (workspaceId: string) => Promise<T>,
): Promise<T | { error: string }> {
  try {
    const { project } = await requireProjectCapability(ctx.userId, ctx.projectId, capability);
    return await fn(project.workspaceId);
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

export function buildProjectTools(ctx: ToolContext) {
  const { projectId, branchId } = ctx;

  return {
    get_project_state: {
      description:
        "Read the full current state of the project: brief, requirements, components (BOM), circuit, 3D model, repos, validation checks, stage statuses. Call this before making changes if you are unsure what already exists.",
      inputSchema: z.object({}),
      execute: async () =>
        guard(ctx, "project.read", async () => {
          const where = { projectId, branchId };
          const codeFiles = await prisma.codeFile.findMany({
            where,
            select: { path: true, repo: { select: { role: true } } },
            orderBy: { path: "asc" },
          });
          const [brief, requirements, components, repoLinks, checks, stageStates, circuit, model3d] =
            await Promise.all([
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
                where: { projectId_branchId_kind: { projectId, branchId, kind: "MODEL3D" } },
              }),
            ]);
          return {
            brief,
            requirements,
            components,
            repoLinks,
            validationChecks: checks,
            stages: stageStates.map((s) => ({ stage: s.stage, status: s.status })),
            circuit: circuit?.data ?? null,
            model3d: model3d?.data ?? null,
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
        "Add components to the bill of materials (Engineer stage). Use the correct discipline: ELECTRONICS for electrical parts, MECHANICAL for enclosure/hardware, SOFTWARE for licensed software/services, DESIGN for finish/appearance items.",
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

    save_circuit: {
      description:
        "Replace the circuit schematic (Engineer > Electronics tab). Lay components out on a 1200x800 canvas with clear spacing (grid of ~120px). Wires connect component pins by index (2-pin parts: 0=left/top, 1=right/bottom; ICs/MCUs: pins count clockwise from top-left).",
      inputSchema: circuitSchema,
      execute: async (doc: CircuitDoc) =>
        guard(ctx, "electronics.edit", async (workspaceId) => {
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
          return {
            ok: true,
            components: doc.components.length,
            wires: doc.wires.length,
            staleStages: staled,
          };
        }),
    },

    save_model3d: {
      description:
        "Replace the parametric 3D model (Engineer > Model tab). Units are millimetres. Compose the product from box/cylinder/sphere parts positioned in 3D space (Y is up, origin at the centre of the assembly).",
      inputSchema: model3dSchema,
      execute: async (doc: Model3dDoc) =>
        guard(ctx, "mechanical.edit", async (workspaceId) => {
          await prisma.designDoc.upsert({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "MODEL3D" } },
            create: {
              projectId,
              branchId,
              kind: "MODEL3D",
              data: doc as unknown as Prisma.InputJsonValue,
              updatedById: ctx.userId,
            },
            update: { data: doc as unknown as Prisma.InputJsonValue, updatedById: ctx.userId },
          });
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return { ok: true, parts: doc.parts.length, staleStages: staled };
        }),
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
        path: z
          .string()
          .min(1)
          .max(300)
          .describe("Repo-relative path, e.g. src/main.cpp"),
        content: z.string().max(200_000),
        repoRole: z
          .string()
          .max(80)
          .optional()
          .describe("Which linked repo to write into (matches the repo's role); defaults to the first repo"),
      }),
      execute: async ({ path, content, repoRole }: { path: string; content: string; repoRole?: string }) =>
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
