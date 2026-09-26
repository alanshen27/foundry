/** Run only against a disposable local database with the realtime server running. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { prisma } from "@foundry/db";
import {
  codeFileRoom,
  designDocumentRoom,
  mintCollabToken,
  applyDesignSnapshot,
  readDesignDocument,
} from "@foundry/collaboration";
import {
  authorizeCollaborationRoom,
  commitCollaborationUpdate,
  loadCollaborationDocument,
  syncCollaborationSnapshot,
  publishCollaborationUpdate,
} from "@foundry/collaboration/server";

const dbUrl = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert(
  ["127.0.0.1", "localhost"].includes(dbUrl.hostname) && dbUrl.pathname === "/foundry_test",
  "Use a disposable LOCAL foundry_test database",
);
const providers: HocuspocusProvider[] = [];
const docs: Y.Doc[] = [];
const rooms = new Set<string>();
const uid = randomUUID();
const base = "const a = 1;\nconst b = 2;\n";
async function until(check: () => boolean | Promise<boolean>, label: string) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out: ${label}`);
}
let workspaceId: string | undefined;
let ownerId: string | undefined;
let guestId: string | undefined;
try {
  const owner = await prisma.user.create({
    data: { email: `owner-${uid}@example.invalid`, name: "Local owner" },
  });
  ownerId = owner.id;
  const guest = await prisma.user.create({
    data: { email: `guest-${uid}@example.invalid`, name: "Local guest" },
  });
  guestId = guest.id;
  const workspace = await prisma.workspace.create({
    data: { name: "Yjs smoke", slug: `yjs-${uid}`, createdById: owner.id },
  });
  workspaceId = workspace.id;
  await prisma.workspaceMembership.createMany({
    data: [
      { workspaceId, userId: owner.id, role: "OWNER" },
      { workspaceId, userId: guest.id, role: "GUEST" },
    ],
  });
  const project = await prisma.project.create({
    data: { workspaceId, name: "Yjs smoke", slug: "smoke", createdById: owner.id },
  });
  const branch = await prisma.projectBranch.create({
    data: { projectId: project.id, name: "main", isDefault: true, createdById: owner.id },
  });
  const scope = { projectId: project.id, branchId: branch.id };
  const repo = await prisma.repoLink.create({
    data: {
      ...scope,
      role: "firmware",
      url: "https://example.invalid/synthetic",
      createdById: owner.id,
    },
  });
  const file = await prisma.codeFile.create({
    data: { ...scope, repoId: repo.id, path: "smoke.ts", content: base, updatedById: owner.id },
  });
  const name = codeFileRoom(file.id);
  const claims = {
    kind: "codefile" as const,
    resourceId: file.id,
    userId: owner.id,
    name: "Owner",
    canEdit: true,
    exp: Date.now() + 60_000,
  };
  await prisma.stageState.create({
    data: {
      ...scope,
      stage: "VERIFY",
      status: "APPROVED",
      approvedById: owner.id,
      approvedAt: new Date(),
    },
  });
  const check = await prisma.validationCheck.create({
    data: { ...scope, title: "Prior check", status: "PASS", createdById: owner.id },
  });
  async function peer(room = name, kind: "codefile" | "design" = "codefile") {
    const doc = new Y.Doc();
    docs.push(doc);
    rooms.add(room);
    const provider = new HocuspocusProvider({
      url: process.env.COLLAB_TEST_URL ?? "ws://127.0.0.1:12341",
      name: room,
      document: doc,
      WebSocketPolyfill: WebSocket,
      token: mintCollabToken(
        { ...claims, kind, resourceId: kind === "design" ? room : file.id },
        process.env.AUTH_SECRET!,
      ),
    });
    providers.push(provider);
    await until(() => provider.synced, "initial room sync");
    return { doc, provider };
  }
  const a = await peer();
  const b = await peer();
  assert.equal(a.doc.getText("monaco").toString(), base);
  a.doc.getText("monaco").insert(base.indexOf("1") + 1, "0");
  b.doc.getText("monaco").insert(base.indexOf("2") + 1, "0");
  const expected = "const a = 10;\nconst b = 20;\n";
  await until(
    () =>
      a.doc.getText("monaco").toString() === expected &&
      b.doc.getText("monaco").toString() === expected,
    "concurrent peer convergence",
  );
  await until(
    async () =>
      (await prisma.codeFile.findUniqueOrThrow({ where: { id: file.id } })).content === expected,
    "SQL commit",
  );
  assert.equal(
    (
      await prisma.stageState.findUniqueOrThrow({
        where: { projectId_branchId_stage: { ...scope, stage: "VERIFY" } },
      })
    ).status,
    "STALE",
  );
  assert.equal(
    (await prisma.validationCheck.findUniqueOrThrow({ where: { id: check.id } })).status,
    "PENDING",
  );
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "CodeFile" WHERE id = ${file.id} FOR UPDATE`;
    const current = (await tx.codeFile.findUniqueOrThrow({ where: { id: file.id } })).content;
    const next = await syncCollaborationSnapshot(tx, {
      documentName: name,
      current,
      before: base,
      after: base + "const c = 3;\n",
    });
    await tx.codeFile.update({ where: { id: file.id }, data: { content: next as string } });
  });
  await publishCollaborationUpdate(name);
  const final = expected + "const c = 3;\n";
  await until(() => b.doc.getText("monaco").toString() === final, "AI API update reaches peers");
  const reopened = await peer();
  assert.equal(reopened.doc.getText("monaco").toString(), final);
  await assert.rejects(
    authorizeCollaborationRoom(name, { ...claims, userId: guest.id }, true),
    /read-only/,
  );
  await assert.rejects(
    authorizeCollaborationRoom(name, { ...claims, resourceId: "wrong" }, true),
    /match/,
  );
  await assert.rejects(authorizeCollaborationRoom(name, { ...claims, exp: 0 }, true), /expired/);
  const run = await prisma.chatRun.create({
    data: {
      ...scope,
      channelId: "synthetic",
      actorId: owner.id,
      inputMessages: [],
      status: "RUNNING",
    },
  });
  const client = new Y.Doc();
  docs.push(client);
  Y.applyUpdate(client, (await loadCollaborationDocument(name)).state);
  const vector = Y.encodeStateVector(client);
  client.getText("monaco").insert(0, "bad");
  await assert.rejects(
    commitCollaborationUpdate(name, Y.encodeStateAsUpdate(client, vector), claims),
    /locked/,
  );
  assert.equal(
    (await prisma.codeFile.findUniqueOrThrow({ where: { id: file.id } })).content,
    final,
  );
  await prisma.chatRun.delete({ where: { id: run.id } });
  const board = {
    version: 5,
    boards: [
      {
        id: "board",
        board: { widthMm: 60, heightMm: 40, thicknessMm: 1.6 },
        footprints: [{ id: "resistor", xMm: 10, yMm: 12 }],
        tracks: [],
      },
    ],
    activeBoardId: "board",
  };
  await prisma.designDoc.create({
    data: { ...scope, kind: "PCB", data: board, updatedById: owner.id },
  });
  const boardRoom = designDocumentRoom(project.id, branch.id, "PCB");
  const p = await peer(boardRoom, "design"),
    q = await peer(boardRoom, "design");
  const moved = structuredClone(board);
  moved.boards[0]!.footprints[0]!.xMm = 25;
  const thick = structuredClone(board);
  thick.boards[0]!.board.thicknessMm = 2;
  applyDesignSnapshot(p.doc, board, moved);
  applyDesignSnapshot(q.doc, board, thick);
  await until(() => {
    const v = readDesignDocument(p.doc) as typeof board;
    return v.boards[0]?.board.thicknessMm === 2 && v.boards[0]?.footprints[0]?.xMm === 25;
  }, "nested board peer merge");
  await until(async () => {
    const v = (
      await prisma.designDoc.findUniqueOrThrow({
        where: { projectId_branchId_kind: { ...scope, kind: "PCB" } },
      })
    ).data as unknown as typeof board;
    return v.boards[0]?.board.thicknessMm === 2 && v.boards[0]?.footprints[0]?.xMm === 25;
  }, "nested board SQL merge");
  console.log(
    "PASS: two websocket clients, concurrent code and PCB edits, atomic SQL persistence, stale AI baseline merge, pub/sub, reconnect, verification reset, guest/expiry/room checks, and AI lease rejection.",
  );
} finally {
  providers.forEach((p) => p.destroy());
  docs.forEach((d) => d.destroy());
  for (const room of rooms)
    await prisma.$executeRaw`DELETE FROM "CollaborationDocument" WHERE "documentName" = ${room}`;
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
  if (guestId) await prisma.user.delete({ where: { id: guestId } });
  await prisma.$disconnect();
}
process.exit(0);
