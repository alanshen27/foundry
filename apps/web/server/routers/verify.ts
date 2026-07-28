import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireProjectCapability } from "../access";
import { ensureStageStarted, markDownstreamStale, setStageStatus } from "../stage-state";

const category = z.enum(["VISUAL", "ELECTRICAL", "MECHANICAL", "SOFTWARE", "CROSS_DOMAIN"]);
const status = z.enum(["PENDING", "PASS", "FAIL", "WARNING", "SKIPPED", "SIMULATED", "ERROR"]);
const severity = z.enum(["INFO", "MINOR", "MAJOR", "CRITICAL"]);

/** A check is satisfied for gating if it passed (or was waived/skipped). */
const BLOCKING_STATUSES = new Set(["PENDING", "FAIL", "ERROR"]);

export const verifyRouter = router({
  listChecks: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      return prisma.validationCheck.findMany({
        where: { projectId: input.projectId, branchId: input.branchId },
        orderBy: [{ category: "asc" }, { createdAt: "asc" }],
      });
    }),

  createCheck: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        category: category.default("CROSS_DOMAIN"),
        title: z.string().min(1).max(200),
        detail: z.string().max(2000).nullish(),
        severity: severity.default("INFO"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "verification.run",
      );
      const { projectId, branchId, ...fields } = input;
      const check = await prisma.validationCheck.create({
        data: { projectId, branchId, createdById: ctx.user.id, ...fields },
      });
      await ensureStageStarted({
        workspaceId: project.workspaceId,
        projectId,
        branchId,
        stage: "VERIFY",
        actorId: ctx.user.id,
      });
      await recordAudit({
        type: "ValidationCheckCreated",
        workspaceId: project.workspaceId,
        projectId,
        branchId,
        actorId: ctx.user.id,
        payload: { checkId: check.id, title: check.title },
      });
      return check;
    }),

  updateCheck: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        category: category.optional(),
        title: z.string().min(1).max(200).optional(),
        detail: z.string().max(2000).nullish(),
        status: status.optional(),
        severity: severity.optional(),
        evidence: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.validationCheck.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        existing.projectId,
        "verification.run",
      );
      const { id, ...fields } = input;
      const check = await prisma.validationCheck.update({ where: { id }, data: fields });
      // Editing results after an approval invalidates the gate.
      if (input.status && input.status !== existing.status) {
        await setStageStatus({
          workspaceId: project.workspaceId,
          projectId: existing.projectId,
          branchId: existing.branchId,
          stage: "VERIFY",
          to: "RUNNING",
          actorId: ctx.user.id,
        });
        await markDownstreamStale({
          workspaceId: project.workspaceId,
          projectId: existing.projectId,
          branchId: existing.branchId,
          changedStage: "VERIFY",
          actorId: ctx.user.id,
        });
      }
      await recordAudit({
        type: "ValidationCheckUpdated",
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        actorId: ctx.user.id,
        payload: { checkId: id, status: check.status },
      });
      return check;
    }),

  waiveCheck: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        waived: z.boolean(),
        waiverReason: z.string().max(1000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.validationCheck.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (input.waived && !input.waiverReason?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A justification is required to waive a check",
        });
      }
      const { project } = await requireProjectCapability(
        ctx.user.id,
        existing.projectId,
        "verification.approve",
      );
      const check = await prisma.validationCheck.update({
        where: { id: input.id },
        data: {
          waived: input.waived,
          waiverReason: input.waived ? input.waiverReason : null,
          approvedById: input.waived ? ctx.user.id : null,
          approvedAt: input.waived ? new Date() : null,
        },
      });
      await recordAudit({
        type: "ValidationCheckWaived",
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        actorId: ctx.user.id,
        payload: { checkId: input.id, waived: input.waived, reason: input.waiverReason ?? null },
      });
      return check;
    }),

  deleteCheck: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.validationCheck.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const { project } = await requireProjectCapability(
        ctx.user.id,
        existing.projectId,
        "verification.run",
      );
      await prisma.validationCheck.delete({ where: { id: input.id } });
      await recordAudit({
        type: "ValidationCheckDeleted",
        workspaceId: project.workspaceId,
        projectId: existing.projectId,
        branchId: existing.branchId,
        actorId: ctx.user.id,
        payload: { checkId: input.id },
      });
      return { id: input.id };
    }),

  approve: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "verification.approve",
      );
      const checks = await prisma.validationCheck.findMany({
        where: { projectId: input.projectId, branchId: input.branchId },
      });
      if (checks.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add at least one validation check before approving",
        });
      }
      const blocking = checks.filter((c) => !c.waived && BLOCKING_STATUSES.has(c.status));
      if (blocking.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${blocking.length} check(s) are unresolved. Resolve or waive them before approving.`,
        });
      }

      const state = await prisma.stageState.findUnique({
        where: {
          projectId_branchId_stage: {
            projectId: input.projectId,
            branchId: input.branchId,
            stage: "VERIFY",
          },
        },
      });
      if (!state) throw new TRPCError({ code: "NOT_FOUND" });
      const from = state.status;
      const updated = await prisma.stageState.update({
        where: { id: state.id },
        data: { status: "APPROVED", approvedById: ctx.user.id, approvedAt: new Date() },
      });
      await recordAudit({
        type: "StageStatusChanged",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { stage: "VERIFY", from, to: "APPROVED" },
      });
      await recordAudit({
        type: "VerificationApproved",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { checks: checks.length, waived: checks.filter((c) => c.waived).length },
      });
      return updated;
    }),
});
