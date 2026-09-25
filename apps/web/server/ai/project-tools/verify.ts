/**
 * Copilot tools: validation checks and the cross-stage integration fit check.
 */

import { z } from "zod";
import { prisma, type Prisma } from "@foundry/db";
import { runFitCheck } from "../../fit-check";
import { recordAudit } from "../../audit";
import { ensureStageStarted } from "../../stage-state";
import { type ToolContext, type ToolKit, guard } from "./shared";

const checkCategory = z.enum(["VISUAL", "ELECTRICAL", "MECHANICAL", "SOFTWARE", "CROSS_DOMAIN"]);

const checkSeverity = z.enum(["INFO", "MINOR", "MAJOR", "CRITICAL"]);

/** Validation checks and the cross-stage integration fit check. */
export function buildVerifyTools(ctx: ToolContext, _kit: ToolKit) {
  const { projectId, branchId } = ctx;

  return {
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

    check_integration: {
      description:
        "The fit check: does the project actually work as one thing? Compares schematic, PCB, firmware, BOM and CAD against each other, then runs the firmware against the schematic in the behavioural simulator (SIMULATED, not compiled) and reports what the run did — pins used but unwired, parts that never activate, contention, serial output. Run it after a bootstrap and after any change that crosses stages, then fix what it reports.",
      inputSchema: z.object({}),
      execute: async () =>
        guard(ctx, "project.read", async () => {
          const report = await runFitCheck(projectId, branchId);
          return {
            ok: report.ok,
            errors: report.counts.errors,
            warnings: report.counts.warnings,
            findings: report.findings,
            simulation: report.simulation,
          };
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
  };
}
