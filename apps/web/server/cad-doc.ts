import { prisma, type Prisma } from "@foundry/db";
import { acquireBranchEditMutex, withAiRunEditLockGuard } from "./ai-edit-lock";
import { pythonCadDoc, normalizeCadDoc, type CadDoc } from "@foundry/cad";
import { designDocumentRoom, COLLABORATION_TRANSACTION_OPTIONS } from "@foundry/collaboration";
import {
  syncCollaborationSnapshot,
  publishCollaborationUpdate,
} from "@foundry/collaboration/server";

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String(err.code) : "";
  const message = err instanceof Error ? err.message : String(err);
  return code === "P2002" || /Unique constraint/i.test(message);
}

/**
 * Atomically read → transform → write MODEL3D. Parallel copilot tool calls
 * previously each loaded the same doc and last-write-wins wiped new parts.
 */
export async function mutateModel3dDoc(
  projectId: string,
  branchId: string,
  userId: string,
  mutate: (doc: CadDoc) => CadDoc,
  runId?: string,
): Promise<CadDoc> {
  try {
    const doc = await writeModel3dDoc(projectId, branchId, userId, mutate, runId);
    await publishCollaborationUpdate(designDocumentRoom(projectId, branchId, "MODEL3D"));
    return doc;
  } catch (err) {
    // First write has no row to lock, so two parallel tool calls can both
    // insert. The loser retries against the now-lockable row.
    if (!isUniqueViolation(err)) throw err;
    const doc = await writeModel3dDoc(projectId, branchId, userId, mutate, runId);
    await publishCollaborationUpdate(designDocumentRoom(projectId, branchId, "MODEL3D"));
    return doc;
  }
}

function writeModel3dDoc(
  projectId: string,
  branchId: string,
  userId: string,
  mutate: (doc: CadDoc) => CadDoc,
  runId?: string,
): Promise<CadDoc> {
  const save = async (tx: Prisma.TransactionClient) => {
    // Lock the row when it exists so concurrent tool calls serialize.
    await tx.$executeRaw`
      SELECT id FROM "DesignDoc"
      WHERE "projectId" = ${projectId}
        AND "branchId" = ${branchId}
        AND kind = CAST('MODEL3D' AS "DesignDocKind")
      FOR UPDATE
    `;

    const existing = await tx.designDoc.findUnique({
      where: { projectId_branchId_kind: { projectId, branchId, kind: "MODEL3D" } },
    });
    const base = existing?.data ? normalizeCadDoc(existing.data) : pythonCadDoc();
    const transformed = mutate(base);
    const next = normalizeCadDoc(
      await syncCollaborationSnapshot(tx, {
        documentName: designDocumentRoom(projectId, branchId, "MODEL3D"),
        current: existing?.data ?? null,
        before: existing?.data ?? null,
        after: transformed,
      }),
    );
    const data = next as unknown as Prisma.InputJsonValue;

    await tx.designDoc.upsert({
      where: { projectId_branchId_kind: { projectId, branchId, kind: "MODEL3D" } },
      create: {
        projectId,
        branchId,
        kind: "MODEL3D",
        data,
        updatedById: userId,
      },
      update: { data, updatedById: userId },
    });

    return next;
  };
  // A CAD tool can finish minutes after Stop. Check its lease in the same
  // transaction as the write so it cannot overwrite a newer turn's model.
  return runId
    ? withAiRunEditLockGuard(projectId, branchId, runId, userId, save)
    : prisma.$transaction(async (tx) => {
        // The SQL row does not exist on the first save. Serialize before the
        // read so parallel first writes cannot both claim a null baseline.
        await acquireBranchEditMutex(tx, projectId, branchId);
        return save(tx);
      }, COLLABORATION_TRANSACTION_OPTIONS);
}
