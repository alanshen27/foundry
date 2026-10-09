import { prisma, type Prisma } from "@foundry/db";
import {
  codeFileRoom,
  designDocumentRoom,
  COLLABORATION_TRANSACTION_OPTIONS,
  type DesignKind,
} from "@foundry/collaboration";
import {
  publishCollaborationUpdate,
  syncCollaborationSnapshot,
} from "@foundry/collaboration/server";
import {
  acquireBranchEditMutex,
  withAiEditLockGuard,
  withAiRunEditLockGuard,
} from "./ai-edit-lock";
import { notifyProjectChanged } from "./project-change";

type Tx = Prisma.TransactionClient;
type Scope = { projectId: string; branchId: string; userId: string; runId?: string };

function writeTransaction<T>(
  scope: Scope,
  write: (tx: Tx) => Promise<T>,
  human = false,
): Promise<T> {
  if (human) return withAiEditLockGuard(scope.projectId, scope.branchId, write);
  if (scope.runId)
    return withAiRunEditLockGuard(
      scope.projectId,
      scope.branchId,
      scope.runId,
      scope.userId,
      write,
    );
  return prisma.$transaction(async (tx) => {
    // Match the lease paths even when no source row exists to lock yet.
    await acquireBranchEditMutex(tx, scope.projectId, scope.branchId);
    return write(tx);
  }, COLLABORATION_TRANSACTION_OPTIONS);
}

export async function writeDesignWithCollaboration(
  input: Scope & { kind: DesignKind; data: unknown; baseData?: unknown },
): Promise<unknown> {
  const name = designDocumentRoom(input.projectId, input.branchId, input.kind);
  const result = await writeTransaction(input, async (tx) => {
    await tx.$executeRaw`SELECT id FROM "DesignDoc" WHERE "projectId" = ${input.projectId} AND "branchId" = ${input.branchId} AND kind = CAST(${input.kind} AS "DesignDocKind") FOR UPDATE`;
    const where = {
      projectId_branchId_kind: {
        projectId: input.projectId,
        branchId: input.branchId,
        kind: input.kind,
      },
    };
    const existing = await tx.designDoc.findUnique({ where });
    const merged = await syncCollaborationSnapshot(tx, {
      documentName: name,
      current: existing?.data ?? null,
      before: input.baseData === undefined ? (existing?.data ?? null) : input.baseData,
      after: input.data,
    });
    const data = merged as Prisma.InputJsonValue;
    await tx.designDoc.upsert({
      where,
      create: { ...where.projectId_branchId_kind, data, updatedById: input.userId },
      update: { data, updatedById: input.userId },
    });
    return merged;
  });
  await publishCollaborationUpdate(name);
  notifyProjectChanged(input.projectId, input.branchId, { kind: "design", design: input.kind });
  return result;
}

export async function writeCodeWithCollaboration(
  input: Scope & {
    repoId: string;
    path: string;
    content: string;
    baseContent?: string;
    human?: boolean;
    createOnly?: boolean;
  },
) {
  let room: string | undefined;
  const result = await writeTransaction(
    input,
    async (tx) => {
      const key = `${input.repoId}:${input.path}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('foundry-codefile-create'), hashtext(${key}))`;
      await tx.$executeRaw`SELECT id FROM "CodeFile" WHERE "repoId" = ${input.repoId} AND path = ${input.path} FOR UPDATE`;
      let file = await tx.codeFile.findUnique({
        where: { repoId_path: { repoId: input.repoId, path: input.path } },
      });
      if (file && input.createOnly) throw new Error("A file with this path already exists");
      file ??= await tx.codeFile.create({
        data: {
          projectId: input.projectId,
          branchId: input.branchId,
          repoId: input.repoId,
          path: input.path,
          content: "",
          updatedById: input.userId,
        },
      });
      room = codeFileRoom(file.id);
      const merged = await syncCollaborationSnapshot(tx, {
        documentName: room,
        current: file.content,
        before: input.baseContent ?? file.content,
        after: input.content,
      });
      return tx.codeFile.update({
        where: { id: file.id },
        data: { content: merged as string, updatedById: input.userId },
      });
    },
    input.human,
  );
  if (room) await publishCollaborationUpdate(room);
  notifyProjectChanged(input.projectId, input.branchId, { kind: "code" });
  return result;
}

export async function deleteCodeWithCollaboration(
  input: Scope & { fileId: string; human?: boolean },
): Promise<void> {
  const name = codeFileRoom(input.fileId);
  await writeTransaction(
    input,
    async (tx) => {
      await tx.$executeRaw`SELECT id FROM "CodeFile" WHERE id = ${input.fileId} FOR UPDATE`;
      await tx.codeFile.delete({ where: { id: input.fileId } });
      await tx.$executeRaw`DELETE FROM "CollaborationDocument" WHERE "documentName" = ${name}`;
    },
    input.human,
  );
  await publishCollaborationUpdate(name);
  notifyProjectChanged(input.projectId, input.branchId, { kind: "code" });
}
