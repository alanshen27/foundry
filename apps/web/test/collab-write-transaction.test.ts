import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { MONACO_YTEXT_KEY, designDocumentRoom } from "@foundry/collaboration";
import { applyDesignSnapshot, readDesignDocument } from "@foundry/collaboration/client";
import { pythonCadDoc, upsertPythonPart } from "@foundry/cad";

type File = { id: string; path: string; content: string };
type State = { state: Uint8Array; revision: number };

const database = vi.hoisted(() => ({
  files: new Map<string, File>(),
  states: new Map<string, State>(),
  designs: new Map<string, unknown>(),
  active: { id: "run", actorId: "user" } as { id: string; actorId: string } | null,
  mutex: Promise.resolve(),
  nextId: 0,
  failSqlUpdate: false,
  notices: [] as string[],
  createdRuns: [] as Date[],
}));

vi.mock("@foundry/config", () => ({ getServerEnv: () => ({ REDIS_URL: "redis://unused" }) }));
vi.mock("ioredis", () => ({
  default: class {
    status = "ready";
    on() {}
    async publish(_channel: string, body: string) {
      database.notices.push((JSON.parse(body) as { documentName: string }).documentName);
    }
  },
}));
vi.mock("@/server/chat-run/stale", () => ({ expireStaleProjectRuns: vi.fn() }));
vi.mock("@foundry/db", () => ({
  prisma: {
    // Model hosted SQL latency and PostgreSQL's branch advisory mutex. Prisma's
    // transaction lifetime includes time waiting on this mutex, not just writes.
    $transaction: async (
      write: (tx: unknown) => Promise<unknown>,
      options?: { timeout?: number },
    ) => {
      const started = new Date();
      const deadline = Date.now() + (options?.timeout ?? 5_000);
      let files = new Map(database.files);
      let states = new Map(database.states);
      let designs = new Map(database.designs);
      let release: (() => void) | undefined;
      let createdAt: Date | undefined;
      const query = async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (Date.now() > deadline)
          throw Object.assign(new Error("Transaction not found or expired"), { code: "P2028" });
      };
      const tx = {
        $executeRaw: async (parts: TemplateStringsArray) => {
          if (parts.join("").includes("foundry-ai-edit")) {
            const previous = database.mutex;
            database.mutex = new Promise<void>((resolve) => {
              release = resolve;
            });
            await previous;
            files = new Map(database.files);
            states = new Map(database.states);
            designs = new Map(database.designs);
          }
          await query();
          return 1;
        },
        $queryRaw: async (parts: TemplateStringsArray, name: string, state?: Uint8Array) => {
          await query();
          if (parts.join("").includes("INSERT INTO")) {
            const revision = (states.get(name)?.revision ?? 0) + 1;
            states.set(name, { state: new Uint8Array(state!), revision });
            return [{ revision }];
          }
          const value = states.get(name);
          return value ? [value] : [];
        },
        chatRun: {
          findFirst: async () => {
            await query();
            return database.active;
          },
          create: async ({ data }: { data: { createdAt?: Date } }) => {
            await query();
            createdAt = data.createdAt ?? started;
            return { id: "new-run" };
          },
        },
        codeFile: {
          findUnique: async ({ where }: { where: { repoId_path: { path: string } } }) => {
            await query();
            return files.get(where.repoId_path.path) ?? null;
          },
          create: async ({ data }: { data: { path: string; content: string } }) => {
            await query();
            const file = { id: `file-${++database.nextId}`, ...data };
            files.set(file.path, file);
            return file;
          },
          update: async ({ where, data }: { where: { id: string }; data: { content: string } }) => {
            await query();
            if (database.failSqlUpdate) throw new Error("SQL write failed");
            const previous = [...files.values()].find((file) => file.id === where.id)!;
            const file = { ...previous, ...data };
            files.set(file.path, file);
            return file;
          },
        },
        designDoc: {
          findUnique: async ({
            where,
          }: {
            where: { projectId_branchId_kind: { kind: string } };
          }) => {
            await query();
            const data = designs.get(where.projectId_branchId_kind.kind);
            return data === undefined ? null : { data };
          },
          upsert: async ({
            where,
            update,
          }: {
            where: { projectId_branchId_kind: { kind: string } };
            update: { data: unknown };
          }) => {
            await query();
            designs.set(where.projectId_branchId_kind.kind, update.data);
            return update;
          },
        },
      };
      try {
        const result = await write(tx);
        database.files = files;
        database.states = states;
        database.designs = designs;
        if (createdAt) database.createdRuns.push(createdAt);
        return result;
      } finally {
        release?.();
      }
    },
  },
}));

const { writeCodeWithCollaboration, writeDesignWithCollaboration } =
  await import("@/server/collab-write");
const { mutateModel3dDoc } = await import("@/server/cad-doc");
const { createExclusiveAiRun } = await import("@/server/ai-edit-lock");
const scope = {
  projectId: "project",
  branchId: "branch",
  userId: "user",
  runId: "run",
  repoId: "repo",
};

beforeEach(() => {
  vi.useFakeTimers();
  database.files = new Map();
  database.states = new Map();
  database.designs = new Map();
  database.active = { id: "run", actorId: "user" };
  database.mutex = Promise.resolve();
  database.nextId = 0;
  database.failSqlUpdate = false;
  database.notices.length = 0;
  database.createdRuns.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("collaborative writes on a hosted database", () => {
  it("serializes first native CAD saves after the viewport has seeded Yjs without a SQL row", async () => {
    const base = pythonCadDoc();
    const name = designDocumentRoom(scope.projectId, scope.branchId, "MODEL3D");
    const seeded = new Y.Doc();
    try {
      applyDesignSnapshot(seeded, null, base);
      database.states.set(name, { state: Y.encodeStateAsUpdate(seeded), revision: 1 });
    } finally {
      seeded.destroy();
    }
    const results = Promise.allSettled(
      ["base", "lid"].map((part) =>
        mutateModel3dDoc(scope.projectId, scope.branchId, scope.userId, (doc) =>
          upsertPythonPart(
            doc,
            part,
            `from build123d import Box\nresult = Box(10, 20, 3)\n# ${part}\n`,
          ),
        ),
      ),
    );
    await vi.runAllTimersAsync();
    expect((await results).map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const reopened = new Y.Doc();
    try {
      Y.applyUpdate(reopened, database.states.get(name)!.state);
      expect(readDesignDocument(reopened)).toMatchObject({
        components: expect.arrayContaining([
          expect.objectContaining({ path: "parts/base/main.py" }),
          expect.objectContaining({ path: "parts/lid/main.py" }),
        ]),
      });
      expect(readDesignDocument(reopened)).toEqual(database.designs.get("MODEL3D"));
    } finally {
      reopened.destroy();
    }
  });

  it("serializes non-run design writers before reading a missing source row", async () => {
    const base = { version: 2, parts: [], wires: [] };
    const name = designDocumentRoom(scope.projectId, scope.branchId, "CIRCUIT");
    const seeded = new Y.Doc();
    try {
      applyDesignSnapshot(seeded, null, base);
      database.states.set(name, { state: Y.encodeStateAsUpdate(seeded), revision: 1 });
    } finally {
      seeded.destroy();
    }
    const results = Promise.allSettled(
      ["resistor", "capacitor"].map((id) =>
        writeDesignWithCollaboration({
          projectId: scope.projectId,
          branchId: scope.branchId,
          userId: scope.userId,
          kind: "CIRCUIT",
          baseData: base,
          data: { ...base, parts: [{ id }] },
        }),
      ),
    );
    await vi.runAllTimersAsync();
    expect((await results).map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(database.designs.get("CIRCUIT")).toEqual({
      ...base,
      parts: [{ id: "resistor" }, { id: "capacitor" }],
    });
  });

  it("starts the pending-run clock after a long branch-lock wait", async () => {
    const started = Date.now();
    database.active = null;
    database.mutex = new Promise((resolve) => setTimeout(resolve, 50_000));
    const result = createExclusiveAiRun({
      projectId: "project",
      branchId: "branch",
      channelId: "channel",
      actorId: "user",
      inputMessages: [],
    });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ created: true, run: { id: "new-run" } });
    expect(database.createdRuns).toHaveLength(1);
    expect(database.createdRuns[0]!.getTime()).toBeGreaterThanOrEqual(started + 50_000);
    expect(Date.now() - database.createdRuns[0]!.getTime()).toBeLessThan(45_000);
  });

  it("commits five parallel tool writes despite SQL latency and branch lock waits", async () => {
    const started = Date.now();
    const results = Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        writeCodeWithCollaboration({
          ...scope,
          path: `${index}.kcl`,
          content: `width = ${index + 1}`,
        }),
      ),
    );
    await vi.runAllTimersAsync();
    expect((await results).map((result) => result.status)).toEqual(Array(5).fill("fulfilled"));
    expect(Date.now() - started).toBeGreaterThan(5_000);
    expect(database.files.size).toBe(5);
    expect(database.notices).toHaveLength(5);
    for (const file of database.files.values()) {
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, database.states.get(`codefile:${file.id}`)!.state);
        expect(doc.getText(MONACO_YTEXT_KEY).toString()).toBe(file.content);
      } finally {
        doc.destroy();
      }
    }
  });

  it("rechecks the lease after waiting and rejects work from a cancelled run", async () => {
    const results = Promise.allSettled([
      writeCodeWithCollaboration({ ...scope, path: "first.kcl", content: "width = 1" }),
      writeCodeWithCollaboration({ ...scope, path: "late.kcl", content: "width = 2" }),
    ]);
    await vi.advanceTimersByTimeAsync(3_000);
    // The first save already owns the lease; the queued save has not checked it.
    database.active = null;
    await vi.runAllTimersAsync();
    const [first, late] = await results;
    expect(first?.status).toBe("fulfilled");
    expect(late).toMatchObject({
      status: "rejected",
      reason: { message: expect.stringContaining("lease") },
    });
    expect([...database.files.keys()]).toEqual(["first.kcl"]);
    expect(database.states.size).toBe(1);
    expect(database.notices).toHaveLength(1);
  });

  it("rolls back CRDT and SQL together and sends no notification when the final write fails", async () => {
    database.failSqlUpdate = true;
    const result = Promise.allSettled([
      writeCodeWithCollaboration({ ...scope, path: "broken.kcl", content: "width = 3" }),
    ]);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject([
      { status: "rejected", reason: { message: "SQL write failed" } },
    ]);
    expect(database.files.size).toBe(0);
    expect(database.states.size).toBe(0);
    expect(database.notices).toHaveLength(0);
  });
});
