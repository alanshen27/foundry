import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma, type Prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireProjectCapability } from "../access";

export const launchRouter = router({
  listReleases: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      return prisma.release.findMany({
        where: { projectId: input.projectId, branchId: input.branchId },
        orderBy: { createdAt: "desc" },
      });
    }),

  getRelease: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const release = await prisma.release.findUnique({ where: { id: input.id } });
      if (!release) throw new TRPCError({ code: "NOT_FOUND" });
      await requireProjectCapability(ctx.user.id, release.projectId, "project.read");
      return release;
    }),

  createRelease: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        version: z
          .string()
          .min(1)
          .max(40)
          .regex(/^[A-Za-z0-9.\-+]+$/, "Use letters, numbers, dot, dash or plus only"),
        notes: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "release.create",
      );

      // Gate: the Verify stage must be APPROVED before a release can be cut.
      const verify = await prisma.stageState.findUnique({
        where: {
          projectId_branchId_stage: {
            projectId: input.projectId,
            branchId: input.branchId,
            stage: "VERIFY",
          },
        },
      });
      if (!verify || verify.status !== "APPROVED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Verification must be approved before creating a release",
        });
      }

      const duplicate = await prisma.release.findUnique({
        where: { projectId_version: { projectId: input.projectId, version: input.version } },
      });
      if (duplicate) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Version ${input.version} already exists`,
        });
      }

      const [requirements, components, repoLinks, checks, designDocs] = await Promise.all([
        prisma.requirement.findMany({
          where: { projectId: input.projectId, branchId: input.branchId },
          orderBy: { createdAt: "asc" },
        }),
        prisma.component.findMany({
          where: { projectId: input.projectId, branchId: input.branchId },
          orderBy: { createdAt: "asc" },
        }),
        prisma.repoLink.findMany({
          where: { projectId: input.projectId, branchId: input.branchId },
          orderBy: { createdAt: "asc" },
        }),
        prisma.validationCheck.findMany({
          where: { projectId: input.projectId, branchId: input.branchId },
          orderBy: { createdAt: "asc" },
        }),
        prisma.designDoc.findMany({
          where: { projectId: input.projectId, branchId: input.branchId },
        }),
      ]);

      const brief = await prisma.projectBrief.findUnique({
        where: {
          projectId_branchId: { projectId: input.projectId, branchId: input.branchId },
        },
      });

      const bomCents = components.reduce((sum, c) => sum + (c.unitCostCents ?? 0) * c.quantity, 0);

      // Immutable, self-contained snapshot (PRD 14.1). Stored as JSON so it is
      // never affected by later edits to the underlying rows.
      const snapshot = {
        capturedAt: new Date().toISOString(),
        project: { id: project.id, name: project.name, slug: project.slug },
        brief,
        requirements,
        components,
        repoLinks,
        validationChecks: checks,
        designDocs: designDocs.map((d) => ({ kind: d.kind, data: d.data })),
        summary: {
          requirements: requirements.length,
          components: components.length,
          repos: repoLinks.length,
          checks: checks.length,
          checksPassed: checks.filter((c) => c.status === "PASS").length,
          checksWaived: checks.filter((c) => c.waived).length,
          bomCents,
        },
      } satisfies Record<string, unknown>;

      const release = await prisma.release.create({
        data: {
          projectId: input.projectId,
          branchId: input.branchId,
          version: input.version,
          notes: input.notes,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          createdById: ctx.user.id,
          createdByName: ctx.user.name,
        },
      });

      await prisma.stageState.updateMany({
        where: { projectId: input.projectId, branchId: input.branchId, stage: "LAUNCH" },
        data: { status: "APPROVED", approvedById: ctx.user.id, approvedAt: new Date() },
      });

      await recordAudit({
        type: "ReleaseCreated",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { releaseId: release.id, version: release.version },
      });
      return release;
    }),
});
