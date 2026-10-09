import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma, type Prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { requireProjectCapability } from "../access";
import { ensureStageStarted, touchProject } from "../stage-state";
import { AiEditLockConflict, getActiveAiEditLock, withAiEditLockGuard } from "../ai-edit-lock";
import { recordAudit } from "../audit";
import { notifyProjectChanged } from "../project-change";
import { designDocumentRoom } from "@foundry/collaboration";
import {
  syncCollaborationSnapshot,
  publishCollaborationUpdate,
} from "@foundry/collaboration/server";

const kind = z.enum(["CIRCUIT", "PCB", "MODEL3D", "DESIGN"]);

const KIND_CAPABILITY = {
  CIRCUIT: "electronics.edit",
  PCB: "electronics.edit",
  MODEL3D: "mechanical.edit",
  DESIGN: "site.edit",
} as const;

export const designRouter = router({
  aiEditLock: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      const lock = await getActiveAiEditLock(input.projectId, input.branchId);
      if (!lock) return null;
      const owner = await prisma.user.findUnique({
        where: { id: lock.actorId },
        select: { name: true },
      });
      return {
        runId: lock.id,
        status: lock.status,
        actorId: lock.actorId,
        actorName: owner?.name ?? "AI collaborator",
        acquiredAt: lock.startedAt ?? lock.createdAt,
      };
    }),

  get: protectedProcedure
    .input(z.object({ projectId: z.string(), branchId: z.string(), kind }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      return prisma.designDoc.findUnique({
        where: {
          projectId_branchId_kind: {
            projectId: input.projectId,
            branchId: input.branchId,
            kind: input.kind,
          },
        },
      });
    }),

  save: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        kind,
        data: z.unknown(),
        baseData: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        KIND_CAPABILITY[input.kind],
      );
      const documentName = designDocumentRoom(input.projectId, input.branchId, input.kind);
      const write = async (db: Prisma.TransactionClient) => {
        const branch = await db.projectBranch.findFirst({
          where: { id: input.branchId, projectId: input.projectId },
          select: { id: true },
        });
        if (!branch)
          throw new TRPCError({ code: "NOT_FOUND", message: "Project branch not found" });
        await db.$executeRaw`
          SELECT id FROM "DesignDoc" WHERE "projectId" = ${input.projectId}
          AND "branchId" = ${input.branchId} AND kind = CAST(${input.kind} AS "DesignDocKind") FOR UPDATE
        `;
        const existing = await db.designDoc.findUnique({
          where: {
            projectId_branchId_kind: {
              projectId: input.projectId,
              branchId: input.branchId,
              kind: input.kind,
            },
          },
        });
        const data = (await syncCollaborationSnapshot(db, {
          documentName,
          current: existing?.data ?? null,
          before: input.baseData === undefined ? (existing?.data ?? null) : input.baseData,
          after: input.data ?? {},
        })) as Prisma.InputJsonValue;
        return db.designDoc.upsert({
          where: {
            projectId_branchId_kind: {
              projectId: input.projectId,
              branchId: input.branchId,
              kind: input.kind,
            },
          },
          create: {
            projectId: input.projectId,
            branchId: input.branchId,
            kind: input.kind,
            data,
            updatedById: ctx.user.id,
          },
          update: { data, updatedById: ctx.user.id },
        });
      };

      let doc;
      try {
        doc = await withAiEditLockGuard(input.projectId, input.branchId, write);
      } catch (error) {
        if (error instanceof AiEditLockConflict) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Workspace locked while an AI agent is editing. Your changes were not saved.",
          });
        }
        throw error;
      }
      await publishCollaborationUpdate(documentName);
      notifyProjectChanged(input.projectId, input.branchId, { kind: "design", design: input.kind });
      await ensureStageStarted({
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        stage: "ENGINEER",
        actorId: ctx.user.id,
      });
      await touchProject({
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        stage: "ENGINEER",
        actorId: ctx.user.id,
      });
      await recordAudit({
        type: "DesignDocUpdated",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { kind: input.kind, designDocId: doc.id },
      });
      return doc;
    }),
});
