import "server-only";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { prisma, type Prisma } from "@foundry/db";
import {
  buildLinkedAssembly,
  normalizeCadDoc,
  type CadAssemblyInstance,
  type CadDoc,
} from "@foundry/cad";
import { normalizePcbSet } from "@/lib/pcb/doc";
import { syncPcbCadParts } from "./assemble-product";
import { seatPcbInstances } from "./seat-assembly";
import { checkAssemblyFit } from "./assembly-fit";
import { buildEngineeringReadiness } from "@/lib/engineering/readiness";
import { designDocumentRoom } from "@foundry/collaboration";
import {
  syncCollaborationSnapshot,
  publishCollaborationUpdate,
} from "@foundry/collaboration/server";
import { requireProjectCapability } from "./access";
import { AiEditLockConflict, withAiEditLockGuard, withAiRunEditLockGuard } from "./ai-edit-lock";
import { recordAudit } from "./audit";
import { notifyProjectChanged } from "./project-change";
import { ensureStageStarted, markDownstreamStale } from "./stage-state";

type Scope = { projectId: string; branchId: string };
type Actor = Scope & { userId: string; runId?: string };
type SnapshotDb = Pick<Prisma.TransactionClient, "projectBranch" | "designDoc">;

async function snapshot(db: SnapshotDb, scope: Scope) {
  const branch = await db.projectBranch.findFirst({
    where: { id: scope.branchId, projectId: scope.projectId },
    select: { id: true },
  });
  if (!branch) throw new TRPCError({ code: "NOT_FOUND", message: "Project branch not found" });
  const rows = await db.designDoc.findMany({
    where: { ...scope, kind: { in: ["CIRCUIT", "PCB", "MODEL3D"] } },
    orderBy: { kind: "asc" },
    select: { kind: true, data: true, updatedAt: true },
  });
  const fingerprint = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const circuit = rows.find((row) => row.kind === "CIRCUIT")?.data ?? null;
  const pcb = rows.find((row) => row.kind === "PCB")?.data ?? null;
  const rawCad = rows.find((row) => row.kind === "MODEL3D")?.data ?? null;
  const cad = rawCad
    ? normalizeCadDoc(rawCad)
    : {
        version: 5 as const,
        engine: "build123d" as const,
        components: [],
        activeId: "",
        script: "",
      };
  return { circuit, pcb, cad, rawCad, fingerprint };
}

export async function getEngineeringStatus(actor: Actor) {
  await requireProjectCapability(actor.userId, actor.projectId, "project.read");
  let canEdit = true;
  try {
    await requireProjectCapability(actor.userId, actor.projectId, "mechanical.edit");
  } catch (error) {
    if (!(error instanceof TRPCError) || error.code !== "FORBIDDEN") throw error;
    canEdit = false;
  }
  const source = await snapshot(prisma, { projectId: actor.projectId, branchId: actor.branchId });
  return {
    fingerprint: source.fingerprint,
    report: buildEngineeringReadiness({ ...source, cad: source.rawCad }),
    canSyncCad: canEdit,
    canBuildAssembly: canEdit,
    cad: source.cad,
  };
}

/** Read, compare and transform under the edit lease and source row locks. */
export async function updateEngineering(
  actor: Actor,
  input:
    | { action: "sync_pcb_to_cad"; expectedFingerprint: string }
    | {
        action: "build_linked_assembly";
        expectedFingerprint: string;
        instances?: CadAssemblyInstance[];
      },
) {
  const { project } = await requireProjectCapability(
    actor.userId,
    actor.projectId,
    "mechanical.edit",
  );
  const scope = { projectId: actor.projectId, branchId: actor.branchId };
  // Measure the housing before taking the row lock. A kernel bbox can take
  // seconds; holding the design lock for that long blocks every other edit.
  let assemblyInstances = input.action === "build_linked_assembly" ? input.instances : undefined;
  let seatNotes: string[] = [];
  if (input.action === "build_linked_assembly") {
    const preview = await snapshot(prisma, scope);
    if (preview.fingerprint === input.expectedFingerprint) {
      try {
        const nativeCad = { ...preview.cad, engine: "build123d" as const };
        const planned = buildLinkedAssembly(nativeCad, input.instances);
        const seated = await seatPcbInstances(
          nativeCad,
          preview.pcb ? normalizePcbSet(preview.pcb) : null,
          planned.assembly?.instances ?? [],
        );
        assemblyInstances = seated.instances;
        seatNotes = seated.notes;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Invalid assembly placement",
        });
      }
    }
  }
  const built: { doc: CadDoc | null } = { doc: null };
  const write = async (tx: Prisma.TransactionClient) => {
    // Stable lock ordering prevents deadlock with CAD mutations. A missing
    // MODEL3D row is protected by the branch edit lease; uniqueness is checked
    // by the database for older writers that do not yet use that lease.
    await tx.$executeRaw`
      SELECT id FROM "DesignDoc"
      WHERE "projectId" = ${actor.projectId} AND "branchId" = ${actor.branchId}
      ORDER BY kind FOR UPDATE
    `;
    const source = await snapshot(tx, scope);
    if (source.fingerprint !== input.expectedFingerprint) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The design changed. Refresh the workflow and review it before applying this update.",
      });
    }
    // New workflow output always uses the local kernel; legacy source stays preserved.
    const nativeCad = { ...source.cad, engine: "build123d" as const };
    let next: CadDoc = nativeCad;
    let updated: string[] = [];
    let removed: string[] = [];
    if (input.action === "sync_pcb_to_cad") {
      if (!source.pcb)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Create and save a PCB first." });
      const sync = syncPcbCadParts(nativeCad, normalizePcbSet(source.pcb));
      if (sync.conflicts.length) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `CAD contains edited board files. Preserve or move those files before syncing: ${sync.conflicts.join("; ")}`,
        });
      }
      next = sync.doc;
      updated = sync.updated;
      removed = sync.removed;
    } else {
      // A linked assembly must not silently assemble old/missing board geometry.
      if (source.pcb) {
        const sync = syncPcbCadParts(nativeCad, normalizePcbSet(source.pcb));
        if (sync.conflicts.length || sync.updated.length || sync.removed.length) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Update CAD from boards before building the assembly.",
          });
        }
      }
      try {
        next = buildLinkedAssembly(nativeCad, assemblyInstances);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Invalid assembly placement",
        });
      }
      updated = [
        next.components.find((part) => part.id === next.activeId)?.path ?? "assembly/product.py",
      ];
    }
    const data = (await syncCollaborationSnapshot(tx, {
      documentName: designDocumentRoom(actor.projectId, actor.branchId, "MODEL3D"),
      current: source.rawCad,
      before: source.rawCad,
      after: next,
    })) as Prisma.InputJsonValue;
    await tx.designDoc.upsert({
      where: { projectId_branchId_kind: { ...scope, kind: "MODEL3D" } },
      create: { ...scope, kind: "MODEL3D", data, updatedById: actor.userId },
      update: { data, updatedById: actor.userId },
    });
    built.doc = input.action === "build_linked_assembly" ? next : null;
    return { updated, removed, seatNotes };
  };
  let changes;
  try {
    changes = actor.runId
      ? await withAiRunEditLockGuard(
          actor.projectId,
          actor.branchId,
          actor.runId,
          actor.userId,
          write,
        )
      : await withAiEditLockGuard(actor.projectId, actor.branchId, write);
  } catch (error) {
    if (error instanceof AiEditLockConflict) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "An AI agent is editing this workspace. Apply the update after it finishes.",
      });
    }
    throw error;
  }
  const stage = { ...scope, workspaceId: project.workspaceId, actorId: actor.userId };
  await publishCollaborationUpdate(designDocumentRoom(actor.projectId, actor.branchId, "MODEL3D"));
  notifyProjectChanged(actor.projectId, actor.branchId, { kind: "design", design: "MODEL3D" });
  await ensureStageStarted({ ...stage, stage: "ENGINEER" });
  await markDownstreamStale({ ...stage, changedStage: "ENGINEER" });
  await recordAudit({
    ...stage,
    actorType: actor.runId ? "AGENT" : "USER",
    type: "DesignDocUpdated",
    payload: {
      kind: "MODEL3D",
      action: input.action,
      sourceFingerprint: input.expectedFingerprint,
      ...changes,
    },
  });
  // Runs after the write and outside the lock: booleans over every solid pair
  // can take tens of seconds.
  const fit = built.doc ? await checkAssemblyFit(built.doc) : undefined;
  return { ...(await getEngineeringStatus(actor)), ...changes, ...(fit ? { fit } : {}) };
}
