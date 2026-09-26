import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { MONACO_YTEXT_KEY, designDocumentRoom } from "../src/rooms";
import type { CollabClaims } from "../src/token";

const mocks = vi.hoisted(() => ({
  state: new Map<string, { state: Uint8Array; revision: number }>(),
  code: { content: "alpha\nkeep\nomega\n" },
  design: { data: null as unknown },
  membership: {
    role: "MEMBER",
    grants: [] as Array<{ projectId: string | null; capability: string }>,
  } as { role: string; grants: Array<{ projectId: string | null; capability: string }> } | null,
  active: false,
  audits: [] as unknown[],
  resets: [] as unknown[],
}));

vi.mock("@foundry/config", () => ({ getServerEnv: () => ({ REDIS_URL: "redis://127.0.0.1:1" }) }));
vi.mock("ioredis", () => ({ default: class {} }));
vi.mock("@foundry/db", () => {
  const db = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async (parts: TemplateStringsArray, ...args: unknown[]) => {
      const sql = parts.join("?");
      const name = String(args[0]);
      if (sql.includes("INSERT INTO")) {
        const revision = (mocks.state.get(name)?.revision ?? 0) + 1;
        mocks.state.set(name, { state: new Uint8Array(args[1] as Uint8Array), revision });
        return [{ revision }];
      }
      const row = mocks.state.get(name);
      return row ? [row] : [];
    }),
    codeFile: {
      findUnique: vi.fn(async () => ({
        id: "file-1",
        projectId: "project-1",
        branchId: "branch-1",
        content: mocks.code.content,
      })),
      update: vi.fn(async ({ data }: { data: { content: string } }) => {
        mocks.code.content = data.content;
        return data;
      }),
    },
    designDoc: {
      findUnique: vi.fn(async () => ({ data: mocks.design.data })),
      upsert: vi.fn(async ({ update }: { update: { data: unknown } }) => {
        mocks.design.data = update.data;
        return update;
      }),
    },
    project: { findUnique: vi.fn(async () => ({ id: "project-1", workspaceId: "workspace-1" })) },
    projectBranch: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; projectId: string } }) =>
        where.id === "branch-1" && where.projectId === "project-1" ? { id: "branch-1" } : null,
      ),
    },
    workspaceMembership: { findUnique: vi.fn(async () => mocks.membership) },
    chatRun: { findFirst: vi.fn(async () => (mocks.active ? { id: "run" } : null)) },
    stageState: { updateMany: vi.fn(async () => ({ count: 1 })) },
    validationCheck: {
      updateMany: vi.fn(async (input: unknown) => {
        mocks.resets.push(input);
        return { count: 1 };
      }),
    },
    auditEvent: {
      create: vi.fn(async (input: unknown) => {
        mocks.audits.push(input);
        return input;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { prisma: db };
});
import { prisma } from "@foundry/db";
import {
  authorizeCollaborationRoom,
  commitCollaborationUpdate,
  loadCollaborationDocument,
  readCollaborationState,
  syncCollaborationSnapshot,
} from "../src/server";
import { applyDesignSnapshot, readDesignDocument } from "../src/document";

const claims = (): CollabClaims => ({
  kind: "codefile",
  resourceId: "file-1",
  userId: "user-1",
  name: "Editor",
  canEdit: true,
  exp: Date.now() + 60_000,
});
const room = "codefile:file-1";

beforeEach(() => {
  mocks.state.clear();
  mocks.code.content = "alpha\nkeep\nomega\n";
  mocks.design.data = null;
  mocks.membership = { role: "MEMBER", grants: [] };
  mocks.active = false;
  mocks.audits.length = 0;
  mocks.resets.length = 0;
});

describe("durable collaboration", () => {
  it("loads and commits atomically when hosted SQL round trips exceed five seconds", async () => {
    let longestTransaction = 0;
    const transact = vi.mocked(prisma.$transaction);
    const original = transact.getMockImplementation()!;
    transact.mockImplementation((async (
      write: (tx: unknown) => Promise<unknown>,
      options?: { timeout?: number },
    ) => {
      let elapsed = 0;
      const wrap = (value: object): object =>
        new Proxy(value, {
          get(target, key) {
            const member = Reflect.get(target, key) as unknown;
            if (typeof member === "function")
              return async (...args: unknown[]) => {
                elapsed += 700;
                if (elapsed > (options?.timeout ?? 5_000))
                  throw Object.assign(new Error("Transaction expired"), { code: "P2028" });
                return member.apply(target, args);
              };
            return member && typeof member === "object" ? wrap(member) : member;
          },
        });
      const result = await write(wrap(prisma));
      longestTransaction = Math.max(longestTransaction, elapsed);
      return result;
    }) as typeof prisma.$transaction);
    const doc = new Y.Doc();
    try {
      const initial = await loadCollaborationDocument(room);
      Y.applyUpdate(doc, initial.state);
      doc.getText(MONACO_YTEXT_KEY).insert(0, "remote edit\n");
      const committed = await commitCollaborationUpdate(room, Y.encodeStateAsUpdate(doc), claims());
      const saved = new Y.Doc();
      try {
        Y.applyUpdate(saved, committed.state);
        expect(saved.getText(MONACO_YTEXT_KEY).toString()).toBe(mocks.code.content);
        expect(mocks.code.content).toBe("remote edit\nalpha\nkeep\nomega\n");
        expect(longestTransaction).toBeGreaterThan(5_000);
        expect(mocks.audits).toHaveLength(1);
      } finally {
        saved.destroy();
      }
    } finally {
      doc.destroy();
      transact.mockImplementation(original);
    }
  });

  it("seeds a canonical empty design once for concurrent first edits", async () => {
    const name = designDocumentRoom("project-1", "branch-1", "CIRCUIT");
    const empty = { version: 2, parts: [], wires: [] };
    const initial = await loadCollaborationDocument(name, () => empty);
    const a = new Y.Doc(),
      b = new Y.Doc();
    Y.applyUpdate(a, initial.state);
    Y.applyUpdate(b, (await loadCollaborationDocument(name, () => ({ wrong: true }))).state);
    applyDesignSnapshot(a, empty, { ...empty, parts: [{ id: "resistor" }] });
    applyDesignSnapshot(b, empty, { ...empty, parts: [{ id: "capacitor" }] });
    const token = { ...claims(), kind: "design" as const, resourceId: name };
    await commitCollaborationUpdate(name, Y.encodeStateAsUpdate(a), token);
    const saved = await commitCollaborationUpdate(name, Y.encodeStateAsUpdate(b), token);
    const result = new Y.Doc();
    Y.applyUpdate(result, saved.state);
    expect(readDesignDocument(result)).toMatchObject({
      parts: expect.arrayContaining([{ id: "resistor" }, { id: "capacitor" }]),
    });
    a.destroy();
    b.destroy();
    result.destroy();
  });

  it("seeds one identity set and reloads it without duplicate text", async () => {
    const a = await loadCollaborationDocument(room);
    const b = await loadCollaborationDocument(room);
    expect(a.state).toEqual(b.state);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, a.state);
    Y.applyUpdate(doc, b.state);
    expect(doc.getText(MONACO_YTEXT_KEY).toString()).toBe(mocks.code.content);
    doc.destroy();
  });

  it("saves the first generated CAD after room seeding and merges a pending client edit", async () => {
    const name = designDocumentRoom("project-1", "branch-1", "MODEL3D");
    const starter = {
      id: "main",
      name: "main",
      kind: "part",
      path: "parts/main.py",
      content: "result = None\n",
    };
    const base = {
      version: 5,
      engine: "build123d",
      activeId: starter.id,
      components: [starter],
      script: starter.content,
    };
    const generated = {
      id: "base",
      name: "base",
      kind: "part",
      path: "parts/base/main.py",
      content: "from build123d import Box\nresult = Box(10, 20, 3)\n",
    };
    const initial = await loadCollaborationDocument(name, () => base);
    expect(mocks.design.data).toBeNull();
    const client = new Y.Doc();
    const reopened = new Y.Doc();
    try {
      Y.applyUpdate(client, initial.state);
      const vector = Y.encodeStateVector(client);
      const editedStarter = { ...starter, content: "result = None\n# local note\n" };
      applyDesignSnapshot(client, base, { ...base, components: [editedStarter] });
      const after = {
        ...base,
        activeId: generated.id,
        script: generated.content,
        components: [starter, generated],
      };
      const merged = await syncCollaborationSnapshot(prisma, {
        documentName: name,
        current: null,
        before: null,
        after,
      });
      expect(merged).toEqual(after);
      // The application writes the bridge's returned snapshot in the same tx.
      mocks.design.data = merged;
      const committed = await commitCollaborationUpdate(
        name,
        Y.encodeStateAsUpdate(client, vector),
        {
          ...claims(),
          kind: "design",
          resourceId: name,
        },
      );
      Y.applyUpdate(client, committed.state);
      Y.applyUpdate(reopened, (await loadCollaborationDocument(name)).state);
      const expected = { ...after, components: [editedStarter, generated] };
      expect(readDesignDocument(client)).toEqual(expected);
      expect(readDesignDocument(reopened)).toEqual(expected);
      expect(mocks.design.data).toEqual(expected);
    } finally {
      client.destroy();
      reopened.destroy();
    }
  });

  it("does not rebase a stale null baseline over an existing SQL design", async () => {
    const name = designDocumentRoom("project-1", "branch-1", "MODEL3D");
    const current = {
      version: 5,
      components: [{ id: "human-part", content: "result = Box(30, 20, 10)" }],
    };
    mocks.design.data = current;
    await loadCollaborationDocument(name);
    const result = await syncCollaborationSnapshot(prisma, {
      documentName: name,
      current,
      before: null,
      after: { version: 5, components: [{ id: "stale-part", content: "result = Box(1, 1, 1)" }] },
    });
    expect(result).toEqual(current);
    expect(mocks.design.data).toEqual(current);
  });

  it("merges a pending Monaco edit with committed AI content, then reloads the same result", async () => {
    const initial = await loadCollaborationDocument(room);
    const client = new Y.Doc();
    Y.applyUpdate(client, initial.state);
    const vector = Y.encodeStateVector(client);
    client.getText(MONACO_YTEXT_KEY).insert("alpha\nkeep".length, " local");
    const before = mocks.code.content;
    const after = "ALPHA\nkeep\nOMEGA\n";
    const merged = await syncCollaborationSnapshot(prisma, { documentName: room, before, after });
    mocks.code.content = merged as string; // Same tx's SQL write in the application.
    const saved = await commitCollaborationUpdate(
      room,
      Y.encodeStateAsUpdate(client, vector),
      claims(),
    );
    Y.applyUpdate(client, saved.state);
    expect(mocks.code.content).toBe("ALPHA\nkeep local\nOMEGA\n");
    expect(client.getText(MONACO_YTEXT_KEY).toString()).toBe(mocks.code.content);
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, (await loadCollaborationDocument(room)).state);
    expect(reopened.getText(MONACO_YTEXT_KEY).toString()).toBe(mocks.code.content);
    expect(mocks.audits).toHaveLength(1);
    expect(mocks.resets[0]).toMatchObject({
      data: { status: "PENDING", waived: false, approvedAt: null },
    });
    client.destroy();
    reopened.destroy();
  });

  it("first source save seeds current SQL instead of a stale client baseline", async () => {
    const before = "alpha\nkeep\nomega\n";
    const current = "alpha\nremote\nomega\n";
    const result = await syncCollaborationSnapshot(prisma, {
      documentName: room,
      before,
      current,
      after: "ALPHA\nkeep\nomega\n",
    });
    expect(result).toBe("ALPHA\nremote\nomega\n");
  });

  it("preserves another board's change across a server design edit", async () => {
    const name = designDocumentRoom("project-1", "branch-1", "PCB");
    const base = {
      boards: [
        { id: "a", x: 1 },
        { id: "b", x: 2 },
      ],
    };
    mocks.design.data = base;
    const initial = await loadCollaborationDocument(name);
    const client = new Y.Doc();
    Y.applyUpdate(client, initial.state);
    applyDesignSnapshot(client, base, {
      boards: [
        { id: "a", x: 10 },
        { id: "b", x: 2 },
      ],
    });
    await syncCollaborationSnapshot(prisma, {
      documentName: name,
      before: base,
      after: {
        boards: [
          { id: "a", x: 1 },
          { id: "b", x: 20 },
        ],
      },
    });
    const saved = await commitCollaborationUpdate(name, Y.encodeStateAsUpdate(client), {
      ...claims(),
      kind: "design",
      resourceId: name,
    });
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, saved.state);
    expect(readDesignDocument(reopened)).toEqual({
      boards: [
        { id: "a", x: 10 },
        { id: "b", x: 20 },
      ],
    });
    expect(mocks.design.data).toEqual(readDesignDocument(reopened));
    client.destroy();
    reopened.destroy();
  });

  it("rejects malformed updates without changing source or durable state", async () => {
    const initial = await loadCollaborationDocument(room);
    await expect(commitCollaborationUpdate(room, Uint8Array.of(255), claims())).rejects.toThrow();
    expect((await readCollaborationState(room))?.state).toEqual(initial.state);
    expect(mocks.code.content).toBe("alpha\nkeep\nomega\n");
    expect(mocks.audits).toHaveLength(0);
  });

  it("rejects oversized code and unexpected shared types before persistence", async () => {
    const initial = await loadCollaborationDocument(room);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, initial.state);
    doc.getText(MONACO_YTEXT_KEY).insert(0, "x".repeat(400_001));
    await expect(
      commitCollaborationUpdate(room, Y.encodeStateAsUpdate(doc), claims()),
    ).rejects.toThrow("400,000");
    expect((await readCollaborationState(room))?.state).toEqual(initial.state);
    const rogue = new Y.Doc();
    Y.applyUpdate(rogue, initial.state);
    rogue.getMap("rogue").set("x", 1);
    await expect(
      commitCollaborationUpdate(room, Y.encodeStateAsUpdate(rogue), claims()),
    ).rejects.toThrow("Unexpected code");
    expect(mocks.audits).toHaveLength(0);
    doc.destroy();
    rogue.destroy();
  });

  it("checks the active AI lease before accepting a human edit", async () => {
    const initial = await loadCollaborationDocument(room);
    mocks.active = true;
    await expect(commitCollaborationUpdate(room, initial.state, claims())).rejects.toThrow(
      "locked",
    );
    expect(mocks.audits).toHaveLength(0);
  });
});

describe("current room access", () => {
  it("does not trust a stale canEdit claim after membership is revoked", async () => {
    mocks.membership = null;
    await expect(authorizeCollaborationRoom(room, claims(), true)).rejects.toThrow("revoked");
  });
  it("keeps guests read-only and accepts only grants for this project", async () => {
    mocks.membership = {
      role: "GUEST",
      grants: [{ projectId: "other-project", capability: "software.edit" }],
    };
    expect((await authorizeCollaborationRoom(room, claims())).canEdit).toBe(false);
    await expect(authorizeCollaborationRoom(room, claims(), true)).rejects.toThrow("read-only");
    mocks.membership.grants = [{ projectId: "project-1", capability: "software.edit" }];
    expect((await authorizeCollaborationRoom(room, claims(), true)).canEdit).toBe(true);
  });
  it("cannot elevate a read-only token even when role allows editing", async () => {
    await expect(
      authorizeCollaborationRoom(room, { ...claims(), canEdit: false }, true),
    ).rejects.toThrow("read-only");
  });
  it("rejects expired and wrong-resource tokens", async () => {
    await expect(authorizeCollaborationRoom(room, { ...claims(), exp: 1 })).rejects.toThrow(
      "expired",
    );
    await expect(authorizeCollaborationRoom("codefile:other", claims())).rejects.toThrow("match");
  });
  it("verifies that a design branch belongs to the claimed project", async () => {
    const name = designDocumentRoom("project-1", "other-branch", "MODEL3D");
    await expect(
      authorizeCollaborationRoom(name, { ...claims(), kind: "design", resourceId: name }),
    ).rejects.toThrow("branch");
  });
});
