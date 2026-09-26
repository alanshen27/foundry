/**
 * Tool-level tests for the copilot's project tools.
 *
 * The tools are the product's largest write path — the model edits briefs,
 * BOMs, schematics, CAD and firmware through them — and until they were split
 * into modules none of them had a direct test. Two kinds of test live here:
 *
 * - A capability table covering all 31 tools: each checks exactly the
 *   capability it is pinned to, and a caller without it gets an error value
 *   back, with nothing written.
 * - Behaviour tests for the tools whose failure modes cost the most: bulk
 *   requirement edits, schematic validation, path traversal in code writes,
 *   and the verify-before-save rule for CAD patches.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCadDoc } from "@foundry/cad";

// ---------- a prisma that records every call ----------

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);
const calls: { model: string; method: string; args: unknown }[] = [];
const overrides = new Map<string, (args: never) => unknown>();

function defaultResult(model: string, method: string, args: Record<string, unknown>) {
  if (method === "findMany") return [];
  if (method === "findUnique" || method === "findFirst") return null;
  if (method === "count") return 0;
  if (method === "createManyAndReturn") {
    const data = (args?.data ?? []) as Record<string, unknown>[];
    return data.map((d, i) => ({ id: `${model}-${i}`, ...d }));
  }
  if (method === "create" || method === "upsert") {
    return { id: `${model}-new`, ...((args?.data ?? args?.create ?? {}) as object) };
  }
  if (method === "deleteMany" || method === "updateMany" || method === "createMany") {
    return { count: 0 };
  }
  return {};
}

const prisma = new Proxy(
  {},
  {
    get: (_t, model: string) =>
      new Proxy(
        {},
        {
          get: (_m, method: string) =>
            vi.fn(async (args: Record<string, unknown>) => {
              calls.push({ model, method, args });
              const override = overrides.get(`${model}.${method}`);
              return override ? override(args as never) : defaultResult(model, method, args);
            }),
        },
      ),
  },
);

const requireProjectCapability = vi.fn();
const recordAudit = vi.fn();
const executeKcl = vi.fn();
const mutateModel3dDoc = vi.fn();

vi.mock("@foundry/db", () => ({ prisma }));
vi.mock("../server/access", () => ({
  requireProjectCapability: (...a: unknown[]) => requireProjectCapability(...a),
}));
vi.mock("../server/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));
vi.mock("../server/stage-state", () => ({
  ensureStageStarted: vi.fn(async () => undefined),
  markDownstreamStale: vi.fn(async () => []),
  setStageStatus: vi.fn(async () => true),
}));
const evaluateCadComponent = vi.hoisted(() => vi.fn());
const writeDesignWithCollaboration = vi.hoisted(() =>
  vi.fn(async (input: { data: unknown }) => input.data),
);
const writeCodeWithCollaboration = vi.hoisted(() => vi.fn(async () => ({ id: "file-1" })));
const deleteCodeWithCollaboration = vi.hoisted(() => vi.fn());

vi.mock("../server/cad", () => ({
  getCad: () => ({ executeKcl }),
  getPythonCad: () => ({ generate: vi.fn() }),
}));
vi.mock("../server/python-cad", () => ({
  evaluateCadComponent: (...a: unknown[]) => evaluateCadComponent(...a),
}));
vi.mock("../server/engineering", () => ({
  getEngineeringStatus: vi.fn(),
  updateEngineering: vi.fn(),
}));
vi.mock("../server/collab-write", () => ({
  writeDesignWithCollaboration: (...a: unknown[]) => writeDesignWithCollaboration(...a),
  writeCodeWithCollaboration: (...a: unknown[]) => writeCodeWithCollaboration(...a),
  deleteCodeWithCollaboration: (...a: unknown[]) => deleteCodeWithCollaboration(...a),
}));
vi.mock("../server/cad-doc", () => ({
  mutateModel3dDoc: (...a: unknown[]) => mutateModel3dDoc(...a),
}));
vi.mock("../server/storage", () => ({ getObjectStorage: vi.fn() }));
vi.mock("../server/fit-check", () => ({ runFitCheck: vi.fn() }));
vi.mock("../server/render-token", () => ({ mintRenderToken: vi.fn() }));
vi.mock("../server/assemble-product", () => ({
  assembleProductWithZooMcp: vi.fn(),
  syncPcbCadPart: vi.fn(),
}));
vi.mock("../server/kcl-project-dir", () => ({ withKclProjectDir: vi.fn() }));
vi.mock("../server/ai/render", () => ({
  extractProductImages: vi.fn(),
  screenshotRenderPage: vi.fn(),
}));
vi.mock("@foundry/cad/server", () => ({ runBuild123d: vi.fn() }));

const { buildProjectTools } = await import("../server/ai/tools");

type AnyTool = {
  description: string;
  inputSchema: unknown;
  execute: (input: unknown, options: unknown) => Promise<unknown>;
};

function tools(graphDirty = { current: false }) {
  return buildProjectTools({
    userId: "user1",
    projectId: "proj1",
    branchId: "branch1",
    origin: "http://localhost:3000",
    graphDirty,
  }) as unknown as Record<string, AnyTool>;
}

const options = { toolCallId: "call1", messages: [] };
const writes = () => calls.filter((c) => WRITE_METHODS.has(c.method));

beforeEach(() => {
  calls.length = 0;
  overrides.clear();
  requireProjectCapability.mockReset().mockResolvedValue({ project: { workspaceId: "ws1" } });
  recordAudit.mockReset().mockResolvedValue(undefined);
  executeKcl.mockReset().mockResolvedValue({ ok: true });
  mutateModel3dDoc.mockReset();
  evaluateCadComponent.mockReset();
  writeDesignWithCollaboration.mockReset().mockImplementation(async (input: { data: unknown }) => input.data);
  writeCodeWithCollaboration.mockReset().mockResolvedValue({ id: "file-1" });
  deleteCodeWithCollaboration.mockReset();
});

// ---------- the capability table ----------

/**
 * What each tool requires. A change here is a permissions change and should
 * be reviewed as one.
 */
const CAPABILITY: Record<string, string> = {
  get_project_state: "project.read",
  update_brief: "ideate.edit",
  add_requirements: "ideate.edit",
  add_components: "electronics.edit",
  remove_requirements: "ideate.edit",
  remove_components: "electronics.edit",
  remove_validation_checks: "verification.run",
  delete_code_file: "software.edit",
  clear_circuit: "electronics.edit",
  extract_product_images: "project.read",
  save_circuit: "electronics.edit",
  import_wokwi_diagram: "electronics.edit",
  define_part_models: "electronics.edit",
  check_integration: "project.read",
  clear_pcb: "electronics.edit",
  save_pcb: "electronics.edit",
  create_cad_component: "mechanical.edit",
  delete_cad_component: "mechanical.edit",
  text_to_cad: "mechanical.edit",
  save_cad_script: "mechanical.edit",
  patch_cad_script: "mechanical.edit",
  python_cad: "mechanical.edit",
  add_part_to_assembly: "mechanical.edit",
  get_engineering_status: "project.read",
  sync_pcb_to_cad: "mechanical.edit",
  build_linked_assembly: "mechanical.edit",
  generate_concept_image: "site.edit",
  render_model_views: "project.read",
  render_circuit: "project.read",
  render_pcb: "project.read",
  add_repo_link: "github.connect",
  add_validation_checks: "verification.run",
  write_code_file: "software.edit",
  // NOTE: this moves a stage to NEEDS_REVIEW (a workflow write, audited) but
  // only requires project.read. Pinned as-is; flagged for a permissions review.
  request_review: "project.read",
};

describe("the tool set", () => {
  it("exposes all project tools in their declared order", () => {
    expect(Object.keys(tools())).toEqual(Object.keys(CAPABILITY));
  });

  it("gives every tool a description, a schema and an executor", () => {
    for (const [name, tool] of Object.entries(tools())) {
      expect(tool.description.trim().length, name).toBeGreaterThan(30);
      expect(tool.inputSchema, name).toBeDefined();
      expect(typeof tool.execute, name).toBe("function");
    }
  });
});

describe("capability checks", () => {
  for (const [name, capability] of Object.entries(CAPABILITY)) {
    it(`${name} requires ${capability}, and writes nothing without it`, async () => {
      requireProjectCapability.mockRejectedValue(new Error(`Missing capability: ${capability}`));
      const result = await tools()[name]!.execute({}, options);
      expect(requireProjectCapability).toHaveBeenCalledWith("user1", "proj1", capability);
      // Failures come back as values the model can explain, never as throws.
      expect(result).toEqual({ error: `Missing capability: ${capability}` });
      expect(writes()).toEqual([]);
      expect(recordAudit).not.toHaveBeenCalled();
    });
  }
});

describe("database failures", () => {
  it("are returned to the model instead of crashing the run", async () => {
    overrides.set("requirement.createManyAndReturn", () => {
      throw new Error("connection reset");
    });
    const result = await tools().add_requirements!.execute(
      { requirements: [{ title: "Runs 8 hours", type: "ELECTRICAL", priority: "MUST" }] },
      options,
    );
    expect(result).toEqual({ error: "connection reset" });
  });
});

// ---------- project state ----------

describe("add_requirements", () => {
  it("scopes rows to the project, audits each as the agent, and marks the graph dirty", async () => {
    const graphDirty = { current: false };
    const result = await tools(graphDirty).add_requirements!.execute(
      {
        requirements: [
          { title: "Runs 8 hours", type: "ELECTRICAL", priority: "MUST" },
          { title: "Under 120 g", type: "MECHANICAL", priority: "SHOULD" },
        ],
      },
      options,
    );
    expect(result).toMatchObject({ ok: true, created: 2 });
    const create = calls.find((c) => c.method === "createManyAndReturn")!;
    for (const row of (create.args as { data: Record<string, unknown>[] }).data) {
      expect(row).toMatchObject({ projectId: "proj1", branchId: "branch1", createdById: "user1" });
    }
    expect(recordAudit).toHaveBeenCalledTimes(2);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "RequirementCreated", actorType: "AGENT" }),
    );
    // The chat run re-derives the product graph once, at the end of the turn.
    expect(graphDirty.current).toBe(true);
  });
});

describe("remove_requirements", () => {
  it("refuses a call that names nothing to remove", async () => {
    expect(await tools().remove_requirements!.execute({}, options)).toEqual({
      error: "Provide ids and/or titleContains",
    });
    expect(writes()).toEqual([]);
  });

  it("matches titles case-insensitively and deletes only the matches", async () => {
    overrides.set("requirement.findMany", () => [
      { id: "r1", title: "Battery lasts 8 hours" },
      { id: "r2", title: "Weighs under 120 g" },
    ]);
    const result = await tools().remove_requirements!.execute(
      { titleContains: ["BATTERY"] },
      options,
    );
    expect(result).toMatchObject({ ok: true, deleted: 1 });
    const del = calls.find((c) => c.method === "deleteMany")!;
    expect(del.args).toEqual({ where: { id: { in: ["r1"] } } });
  });

  it("writes nothing when nothing matches", async () => {
    overrides.set("requirement.findMany", () => [{ id: "r1", title: "Battery lasts 8 hours" }]);
    const result = await tools().remove_requirements!.execute({ ids: ["nope"] }, options);
    expect(result).toEqual({ ok: true, deleted: 0 });
    expect(writes()).toEqual([]);
  });
});

// ---------- electronics ----------

describe("save_circuit", () => {
  const led = {
    parts: [
      { id: "uno", type: "wokwi-arduino-uno", x: 0, y: 0 },
      { id: "led", type: "wokwi-led", x: 200, y: 0 },
    ],
    wires: [{ id: "w1", from: { part: "uno", pin: "13" }, to: { part: "led", pin: "A" } }],
  };

  it("rejects part types that cannot render, before writing anything", async () => {
    const result = (await tools().save_circuit!.execute(
      { ...led, parts: [...led.parts, { id: "x", type: "wokwi-made-up-sensor", x: 0, y: 0 }] },
      options,
    )) as { error: string };
    expect(result.error).toContain("wokwi-made-up-sensor");
    expect(writes()).toEqual([]);
  });

  it("saves a valid schematic as the project's CIRCUIT document", async () => {
    const result = await tools().save_circuit!.execute(led, options);
    expect(result).toMatchObject({ ok: true, parts: 2, wires: 1 });
    expect(writeDesignWithCollaboration).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj1",
        branchId: "branch1",
        kind: "CIRCUIT",
      }),
    );
  });
});

// ---------- code ----------

describe("write_code_file", () => {
  it.each(["../../etc/passwd", "/etc/passwd", "src/../../secrets"])(
    "rejects the path %s",
    async (path) => {
      expect(await tools().write_code_file!.execute({ path, content: "x" }, options)).toEqual({
        error: "Invalid path",
      });
      expect(writes()).toEqual([]);
    },
  );

  it("creates a placeholder repository when none is linked, then writes the file", async () => {
    const result = await tools().write_code_file!.execute(
      { path: "src/main.cpp", content: "void setup() {}" },
      options,
    );
    expect(result).toMatchObject({ ok: true, repo: "firmware", path: "src/main.cpp", bytes: 15 });
    expect(calls.find((c) => c.model === "repoLink" && c.method === "create")).toBeDefined();
    expect(writeCodeWithCollaboration).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/main.cpp", content: "void setup() {}" }),
    );
  });

  it("writes into the existing repository when one is linked", async () => {
    overrides.set("repoLink.findFirst", () => ({ id: "repo1", role: "firmware" }));
    await tools().write_code_file!.execute({ path: "src/main.cpp", content: "x" }, options);
    expect(calls.find((c) => c.model === "repoLink" && c.method === "create")).toBeUndefined();
  });
});

// ---------- CAD ----------

describe("patch_cad_script", () => {
  const doc = normalizeCadDoc({
    version: 5,
    engine: "build123d",
    activeId: "c1",
    script: "",
    components: [
      {
        id: "c1",
        kind: "part",
        name: "lid",
        path: "parts/lid/main.py",
        content: "width = 60\nresult = Box(width, 10, 10)\n",
      },
    ],
  });

  beforeEach(() => {
    overrides.set("designDoc.findUnique", () => ({ data: doc }));
    mutateModel3dDoc.mockImplementation(async (_p, _b, _u, mutate: (d: typeof doc) => typeof doc) =>
      mutate(doc),
    );
    evaluateCadComponent.mockResolvedValue({
      valid: true,
      solidCount: 1,
      volumeMm3: 6000,
      bbox: { center: { x: 0, y: 0, z: 0 }, dimensions: { x: 60, y: 10, z: 10 } },
    });
  });

  it("refuses an edit whose find text is not in the file, saving nothing", async () => {
    const result = (await tools().patch_cad_script!.execute(
      { partName: "lid", edits: [{ find: "height = 10", replace: "height = 12" }] },
      options,
    )) as { error?: string };
    expect(result.error).toBeTruthy();
    expect(mutateModel3dDoc).not.toHaveBeenCalled();
  });

  it("refuses a patch the engine cannot execute, saving nothing", async () => {
    evaluateCadComponent.mockRejectedValue(new Error("unexpected token"));
    const result = (await tools().patch_cad_script!.execute(
      { partName: "lid", edits: [{ find: "width = 60", replace: "width = )" }] },
      options,
    )) as { error: string };
    expect(result.error).toContain("unexpected token");
    expect(mutateModel3dDoc).not.toHaveBeenCalled();
  });

  it("saves a patch that executes, and reports it as engine-verified", async () => {
    const result = await tools().patch_cad_script!.execute(
      { partName: "parts/lid/main.py", edits: [{ find: "width = 60", replace: "width = 64" }] },
      options,
    );
    expect(evaluateCadComponent).toHaveBeenCalled();
    expect(mutateModel3dDoc).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, verified: true, editsApplied: 1 });
  });

  it("names the component it could not find", async () => {
    const result = (await tools().patch_cad_script!.execute(
      { partName: "bracket", edits: [{ find: "a", replace: "b" }] },
      options,
    )) as { error: string };
    expect(result.error).toContain('"bracket"');
  });
});
