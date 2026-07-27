import { prisma, type Prisma } from "@foundry/db";
import { cadDoc, normalizeCadDoc, type CadDoc } from "@/lib/cad/engine";

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
): Promise<CadDoc> {
  try {
    return await writeModel3dDoc(projectId, branchId, userId, mutate);
  } catch (err) {
    // First write has no row to lock, so two parallel tool calls can both
    // insert. The loser retries against the now-lockable row.
    if (!isUniqueViolation(err)) throw err;
    return writeModel3dDoc(projectId, branchId, userId, mutate);
  }
}

function writeModel3dDoc(
  projectId: string,
  branchId: string,
  userId: string,
  mutate: (doc: CadDoc) => CadDoc,
): Promise<CadDoc> {
  return prisma.$transaction(async (tx) => {
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
    const base = existing?.data ? normalizeCadDoc(existing.data) : cadDoc("");
    const next = mutate(base);
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
  });
}
