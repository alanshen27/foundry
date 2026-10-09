/** Server-only durable Yjs state and committed-update transport. */
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import Redis from "ioredis";
import { prisma, type Prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import {
  hasCapability,
  VERIFICATION_RERUN_STATUSES,
  verificationResetForEngineeringChange,
  type Capability,
  type WorkspaceRole,
} from "@foundry/domain";
import { applyDesignSnapshot, applyTextSnapshot, readDesignDocument } from "./document";
import {
  MONACO_YTEXT_KEY,
  parseCodeFileRoom,
  parseDesignDocumentRoom,
  parseSitePromptRoom,
} from "./rooms";
import type { CollabClaims } from "./token";
import { COLLABORATION_TRANSACTION_OPTIONS } from "./transaction";

type Tx = Prisma.TransactionClient;
export type DurableState = { state: Uint8Array; revision: number };
const CHANNEL = "foundry:collaboration:committed:v1";
const MAX_STATE_BYTES = 16_000_000;
const MAX_DESIGN_BYTES = 8_000_000;

export async function readCollaborationState(
  documentName: string,
  db: Pick<Tx, "$queryRaw"> = prisma,
): Promise<DurableState | null> {
  const rows = await db.$queryRaw<Array<{ state: Uint8Array; revision: number }>>`
    SELECT state, revision FROM "CollaborationDocument" WHERE "documentName" = ${documentName}
  `;
  return rows[0] ?? null;
}

/** Cheap existence probe; seeding still goes through loadCollaborationDocument. */
export async function hasCollaborationState(
  documentName: string,
  db: Pick<Tx, "$queryRaw"> = prisma,
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ found: number }>>`
    SELECT 1 AS found FROM "CollaborationDocument" WHERE "documentName" = ${documentName} LIMIT 1
  `;
  return rows.length > 0;
}

async function lockState(tx: Tx, name: string): Promise<void> {
  // Also serializes first writes, when no row exists to SELECT FOR UPDATE.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('foundry-collaboration'), hashtext(${name}))`;
}

function snapshot(doc: Y.Doc, name: string): unknown {
  return parseCodeFileRoom(name)
    ? doc.getText(MONACO_YTEXT_KEY).toString()
    : readDesignDocument(doc);
}

function applySnapshot(doc: Y.Doc, name: string, before: unknown, after: unknown): void {
  if (parseCodeFileRoom(name)) {
    if (typeof after !== "string") throw new Error("Code collaboration requires text");
    applyTextSnapshot(
      doc.getText(MONACO_YTEXT_KEY),
      typeof before === "string" ? before : "",
      after,
    );
  } else if (parseDesignDocumentRoom(name)) {
    applyDesignSnapshot(doc, before, after);
  } else {
    throw new Error("Unsupported durable collaboration room");
  }
}

function validateSnapshot(doc: Y.Doc, name: string): void {
  const value = snapshot(doc, name);
  if (parseCodeFileRoom(name)) {
    if (typeof value !== "string" || value.length > 400_000)
      throw new Error("Code file exceeds 400,000 characters");
    if ([...doc.share.keys()].some((key) => key !== MONACO_YTEXT_KEY))
      throw new Error("Unexpected code document field");
  } else if (Buffer.byteLength(JSON.stringify(value) ?? "null") > MAX_DESIGN_BYTES) {
    throw new Error("Design document exceeds 8 MB");
  }
}

async function storeState(tx: Tx, name: string, doc: Y.Doc): Promise<DurableState> {
  validateSnapshot(doc, name);
  const state = Y.encodeStateAsUpdate(doc);
  if (state.length > MAX_STATE_BYTES) throw new Error("Collaboration document exceeds 16 MB");
  const rows = await tx.$queryRaw<Array<{ revision: number }>>`
    INSERT INTO "CollaborationDocument" ("documentName", state, revision, "updatedAt")
    VALUES (${name}, ${Buffer.from(state)}, 1, NOW())
    ON CONFLICT ("documentName") DO UPDATE
    SET state = EXCLUDED.state, revision = "CollaborationDocument".revision + 1, "updatedAt" = NOW()
    RETURNING revision
  `;
  return { state, revision: rows[0]!.revision };
}

/**
 * Call after locking the source row, and write the returned materialized value
 * to that source in the same transaction. before is the caller's edit baseline;
 * unchanged fields from stale callers must never replace newer CRDT fields.
 */
export async function syncCollaborationSnapshot(
  tx: Tx,
  input: { documentName: string; before: unknown; after: unknown; current?: unknown },
): Promise<unknown> {
  await lockState(tx, input.documentName);
  const existing = await readCollaborationState(input.documentName, tx);
  const doc = new Y.Doc();
  try {
    const current = input.current === undefined ? input.before : input.current;
    if (existing) Y.applyUpdate(doc, existing.state);
    else {
      if (current != null) applySnapshot(doc, input.documentName, null, current);
    }
    // Opening a design can seed durable Yjs defaults before its first SQL row
    // exists. Null is seed-only in the client patcher, so use that shared seed
    // as the first server edit's baseline. Both locks are held here; committed
    // client edits also create SQL, and a stale null baseline must never rebase
    // onto them. Patching the seed retains identities for pending client edits.
    const before =
      existing && current == null && input.before == null
        ? snapshot(doc, input.documentName)
        : input.before;
    applySnapshot(doc, input.documentName, before, input.after);
    await storeState(tx, input.documentName, doc);
    return snapshot(doc, input.documentName);
  } finally {
    doc.destroy();
  }
}

export type RoomSource = {
  projectId: string | null;
  branchId: string | null;
  workspaceId: string;
  capability: Capability;
  fileId?: string;
  design?: NonNullable<ReturnType<typeof parseDesignDocumentRoom>>;
};

export async function resolveRoomSource(
  documentName: string,
  db: Tx | typeof prisma = prisma,
): Promise<RoomSource> {
  const fileId = parseCodeFileRoom(documentName);
  const design = parseDesignDocumentRoom(documentName);
  const siteId = parseSitePromptRoom(documentName);
  if (siteId) {
    const site = await db.site.findUnique({ where: { id: siteId } });
    if (!site) throw new Error("Collaboration resource not found");
    return {
      projectId: site.projectId,
      branchId: null,
      workspaceId: site.workspaceId,
      capability: "site.edit",
    };
  }
  const file = fileId ? await db.codeFile.findUnique({ where: { id: fileId } }) : null;
  const projectId = design?.projectId ?? file?.projectId;
  const branchId = design?.branchId ?? file?.branchId;
  if (!projectId || !branchId) throw new Error("Collaboration resource not found");
  const project = await db.project.findUnique({ where: { id: projectId } });
  const branch = await db.projectBranch.findFirst({ where: { id: branchId, projectId } });
  if (!project || !branch) throw new Error("Collaboration branch not found");
  const capability: Capability = !design
    ? "software.edit"
    : design.kind === "MODEL3D"
      ? "mechanical.edit"
      : design.kind === "DESIGN"
        ? "site.edit"
        : "electronics.edit";
  return {
    projectId,
    branchId,
    workspaceId: project.workspaceId,
    capability,
    ...(fileId ? { fileId } : {}),
    ...(design ? { design } : {}),
  };
}

/** Revalidate membership and scoped grants; token canEdit is only an upper bound. */
export async function authorizeCollaborationRoom(
  documentName: string,
  claims: CollabClaims,
  edit = false,
  db: Tx | typeof prisma = prisma,
): Promise<{ source: RoomSource; canEdit: boolean }> {
  if (claims.exp <= Date.now()) throw new Error("Collaboration session expired");
  const matches =
    claims.kind === "design"
      ? parseDesignDocumentRoom(documentName) && claims.resourceId === documentName
      : claims.kind === "codefile"
        ? parseCodeFileRoom(documentName) === claims.resourceId
        : parseSitePromptRoom(documentName) === claims.resourceId;
  if (!matches) throw new Error("Token does not match document");
  const source = await resolveRoomSource(documentName, db);
  const membership = await db.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: source.workspaceId, userId: claims.userId } },
    include: { grants: true },
  });
  if (!membership) throw new Error("Workspace access revoked");
  const grants = membership.grants
    .filter((g) => g.projectId === null || g.projectId === source.projectId)
    .map((g) => g.capability as Capability);
  const role = membership.role as WorkspaceRole;
  if (!hasCapability(role, grants, "project.read")) throw new Error("Workspace access revoked");
  const canEdit = claims.canEdit && hasCapability(role, grants, source.capability);
  if (edit && !canEdit) throw new Error("Collaboration document is read-only");
  return { source, canEdit };
}

async function lockSource(tx: Tx, name: string, source: RoomSource): Promise<unknown> {
  if (source.fileId) {
    await tx.$executeRaw`SELECT id FROM "CodeFile" WHERE id = ${source.fileId} FOR UPDATE`;
    const file = await tx.codeFile.findUnique({ where: { id: source.fileId } });
    if (!file) throw new Error("Code file no longer exists");
    return file.content;
  }
  if (!source.design) throw new Error("Room is not persisted");
  const { projectId, branchId, kind } = source.design;
  await tx.$executeRaw`SELECT id FROM "DesignDoc" WHERE "projectId" = ${projectId} AND "branchId" = ${branchId} AND kind = CAST(${kind} AS "DesignDocKind") FOR UPDATE`;
  return (
    (
      await tx.designDoc.findUnique({
        where: { projectId_branchId_kind: { projectId, branchId, kind } },
      })
    )?.data ?? null
  );
}

/** Seed exactly once so all clients share the same initial CRDT identities. */
export async function loadCollaborationDocument(
  name: string,
  normalize?: (data: unknown) => unknown,
): Promise<DurableState> {
  return prisma.$transaction(async (tx) => {
    const source = await resolveRoomSource(name, tx);
    const current = await lockSource(tx, name, source);
    await lockState(tx, name);
    const existing = await readCollaborationState(name, tx);
    if (existing) return existing;
    const doc = new Y.Doc();
    try {
      const initial = normalize ? normalize(current) : current;
      if (initial != null) applySnapshot(doc, name, null, initial);
      return await storeState(tx, name, doc);
    } finally {
      doc.destroy();
    }
  }, COLLABORATION_TRANSACTION_OPTIONS);
}

/** Commit the Yjs update before broadcasting/acknowledging it to clients. */
export async function commitCollaborationUpdate(
  name: string,
  update: Uint8Array,
  claims: CollabClaims,
): Promise<DurableState> {
  if (update.length > MAX_STATE_BYTES) throw new Error("Collaboration update is too large");
  return prisma.$transaction(async (tx) => {
    const { source } = await authorizeCollaborationRoom(name, claims, true, tx);
    const branchKey = `${source.projectId}:${source.branchId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('foundry-ai-edit'), hashtext(${branchKey}))`;
    const activeRun = await tx.chatRun.findFirst({
      where: {
        projectId: source.projectId!,
        branchId: source.branchId!,
        status: { in: ["PENDING", "RUNNING"] },
      },
      select: { id: true },
    });
    if (activeRun) throw new Error("Workspace locked while an AI agent is editing");
    const current = await lockSource(tx, name, source);
    await lockState(tx, name);
    const existing = await readCollaborationState(name, tx);
    const doc = new Y.Doc();
    try {
      if (existing) Y.applyUpdate(doc, existing.state);
      else if (current != null) applySnapshot(doc, name, null, current);
      const before = snapshot(doc, name);
      Y.applyUpdate(doc, update);
      const next = snapshot(doc, name);
      const stored = await storeState(tx, name, doc);
      if (JSON.stringify(before) === JSON.stringify(next)) return stored;
      if (source.fileId) {
        await tx.codeFile.update({
          where: { id: source.fileId },
          data: { content: next as string, updatedById: claims.userId },
        });
      } else if (source.design) {
        const data = next as Prisma.InputJsonValue;
        await tx.designDoc.upsert({
          where: { projectId_branchId_kind: source.design },
          create: { ...source.design, data, updatedById: claims.userId },
          update: { data, updatedById: claims.userId },
        });
      }
      await recordLiveEdit(tx, source, claims.userId, name, stored.revision);
      return stored;
    } finally {
      doc.destroy();
    }
  }, COLLABORATION_TRANSACTION_OPTIONS);
}

async function recordLiveEdit(
  tx: Tx,
  source: RoomSource,
  actorId: string,
  documentName: string,
  revision: number,
): Promise<void> {
  const scope = { projectId: source.projectId!, branchId: source.branchId! };
  await tx.stageState.updateMany({
    where: { ...scope, stage: "ENGINEER", status: "NOT_STARTED" },
    data: { status: "DRAFT" },
  });
  await tx.stageState.updateMany({
    where: { ...scope, stage: { in: ["VERIFY", "LAUNCH"] }, status: "APPROVED" },
    data: { status: "STALE", approvedById: null, approvedAt: null, approvedSnapshotId: null },
  });
  await tx.stageState.updateMany({
    where: { ...scope, stage: { in: ["VERIFY", "LAUNCH"] }, status: "NEEDS_REVIEW" },
    data: { status: "DRAFT", approvedById: null, approvedAt: null, approvedSnapshotId: null },
  });
  await tx.validationCheck.updateMany({
    where: {
      ...scope,
      OR: [{ status: { in: [...VERIFICATION_RERUN_STATUSES] } }, { waived: true }],
    },
    data: verificationResetForEngineeringChange(),
  });
  await tx.auditEvent.create({
    data: {
      ...scope,
      workspaceId: source.workspaceId,
      actorId,
      actorType: "USER",
      type: "CollaborationDocumentUpdated",
      payload: { documentName, revision, source: "yjs" },
    },
  });
}

let publisher: Redis | null = null;
function connection(): Redis {
  const client = new Redis(getServerEnv().REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1500,
  });
  client.on("error", () => {
    /* Callers report errors without credentials. */
  });
  return client;
}

/** Best effort wake-up. Durable state is authoritative and reconciled on reconnect. */
export async function publishCollaborationUpdate(documentName: string): Promise<void> {
  try {
    publisher ??= connection();
    if (publisher.status === "wait") await publisher.connect();
    await publisher.publish(CHANNEL, JSON.stringify({ documentName, id: randomUUID() }));
  } catch {
    console.warn("[collab] Committed state saved; live notification unavailable");
  }
}

export async function subscribeCollaborationUpdates(
  onUpdate: (name: string) => void,
): Promise<() => void> {
  const client = connection();
  client.on("message", (_channel, body: string) => {
    try {
      const data = JSON.parse(body) as { documentName?: unknown };
      if (typeof data.documentName === "string") onUpdate(data.documentName);
    } catch {
      /* Ignore malformed notifications. */
    }
  });
  await client.connect();
  await client.subscribe(CHANNEL);
  return () => {
    client.disconnect();
  };
}
