import { prisma, type Prisma } from "@foundry/db";
import type { DomainEventType } from "@foundry/domain";

export async function recordAudit(params: {
  type: DomainEventType;
  workspaceId: string;
  projectId?: string | null;
  branchId?: string | null;
  actorId: string;
  actorType?: "USER" | "AGENT" | "SYSTEM";
  payload: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      type: params.type,
      workspaceId: params.workspaceId,
      projectId: params.projectId ?? null,
      branchId: params.branchId ?? null,
      actorId: params.actorId,
      actorType: params.actorType ?? "USER",
      payload: params.payload as Prisma.InputJsonValue,
    },
  });
}
