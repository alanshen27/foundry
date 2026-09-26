import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cadDoc,
  pythonCadDoc,
  upsertPartScripts,
  upsertPythonPart,
  buildLinkedAssembly,
  type CadAssemblyInstance,
  type CadDoc,
} from "@foundry/cad";

const generate = vi.fn();
const evaluate = vi.fn();
const legacyCad = vi.fn();
const storagePut = vi.fn();
const screenshot = vi.fn();
const requireProjectCapability = vi.fn();
const mutateModel3dDoc = vi.fn();
const markDownstreamStale = vi.fn();
const onCadProgressEnd = vi.fn();
const designFindUnique = vi.fn();
const designUpsert = vi.fn();
const recordAudit = vi.fn();
const getEngineeringStatus = vi.fn();
const updateEngineering = vi.fn();

vi.mock("@foundry/db", () => ({
  prisma: {
    designDoc: {
      findUnique: (...args: unknown[]) => designFindUnique(...args),
      upsert: (...args: unknown[]) => designUpsert(...args),
    },
  },
}));
vi.mock("@foundry/config", () => ({ getServerEnv: () => ({}) }));
vi.mock("@foundry/sourcing", () => ({
  hasSubstituteOf: () => false,
  lifecycleStatusOf: () => "unknown",
  partKeyOf: () => "",
}));
vi.mock("@/server/cad", () => ({
  getPythonCad: () => ({ generate }),
  getCad: (...args: unknown[]) => legacyCad(...args),
}));
vi.mock("@/server/python-cad", () => ({
  evaluateCadComponent: (...args: unknown[]) => evaluate(...args),
}));
vi.mock("@/server/engineering", () => ({
  getEngineeringStatus: (...args: unknown[]) => getEngineeringStatus(...args),
  updateEngineering: (...args: unknown[]) => updateEngineering(...args),
}));
vi.mock("@/server/access", () => ({
  requireProjectCapability: (...args: unknown[]) => requireProjectCapability(...args),
}));
vi.mock("@/server/cad-doc", () => ({
  mutateModel3dDoc: (...args: unknown[]) => mutateModel3dDoc(...args),
}));
vi.mock("@/server/collab-write", () => ({
  writeDesignWithCollaboration: async (input: { data: unknown }) => {
    await designUpsert({ update: { data: input.data } });
    return input.data;
  },
  writeCodeWithCollaboration: vi.fn(),
  deleteCodeWithCollaboration: vi.fn(),
}));
vi.mock("@/server/audit", () => ({ recordAudit: (...args: unknown[]) => recordAudit(...args) }));
vi.mock("@/server/stage-state", () => ({
  ensureStageStarted: vi.fn(),
  markDownstreamStale: (...args: unknown[]) => markDownstreamStale(...args),
  setStageStatus: vi.fn(),
}));
vi.mock("@/server/storage", () => ({ getObjectStorage: () => ({ put: storagePut }) }));
vi.mock("@/server/render-token", () => ({ mintRenderToken: vi.fn() }));
vi.mock("@/server/ai/render", () => ({
  extractProductImages: vi.fn(),
  screenshotRenderPage: (...args: unknown[]) => screenshot(...args),
}));

const { buildProjectTools } = await import("@/server/ai/tools");

const context = {
  userId: "user-1",
  projectId: "project-1",
  branchId: "branch-1",
  origin: "http://localhost:3000",
  onCadProgressEnd,
};

beforeEach(() => {
  vi.resetAllMocks();
  requireProjectCapability.mockResolvedValue({ project: { workspaceId: "workspace-1" } });
  evaluate.mockResolvedValue({
    valid: true,
    solidCount: 1,
    volumeMm3: 1000,
    bbox: { center: { x: 0, y: 0, z: 0 }, dimensions: { x: 10, y: 10, z: 10 } },
  });
  legacyCad.mockImplementation(() => {
    throw new Error("Zoo must not be called");
  });
  markDownstreamStale.mockResolvedValue(["VERIFY", "LAUNCH"]);
  designFindUnique.mockResolvedValue(null);
  designUpsert.mockResolvedValue({ id: "design-1" });
  mutateModel3dDoc.mockImplementation(
    (_project: string, _branch: string, _user: string, mutate: (doc: CadDoc) => CadDoc) =>
      mutate(cadDoc("")),
  );
});

describe("electrical copilot persistence", () => {
  const prior = {
    version: 2,
    parts: [{ id: "r", type: "wokwi-resistor", label: "R1", x: 0, y: 0 }],
    wires: [
      { id: "wire", from: { part: "r", pin: "1" }, to: { part: "r", pin: "2" }, label: "SENSE" },
    ],
    groups: [{ id: "board", label: "Main", x: -10, y: -10, w: 100, h: 100 }],
    sketchFileId: "firmware-1",
  };

  it("keeps regions, simulator reference and unchanged wire labels on schematic edits", async () => {
    designFindUnique.mockResolvedValue({ data: prior });
    const tool = buildProjectTools(context).save_circuit;
    const input = tool.inputSchema.parse({
      parts: prior.parts,
      wires: prior.wires.map(({ label: _label, ...wire }) => ({ ...wire, id: "new-wire-id" })),
    });

    expect(await tool.execute(input)).toMatchObject({ ok: true });
    expect(designUpsert.mock.calls[0]?.[0].update.data).toMatchObject({
      groups: prior.groups,
      sketchFileId: prior.sketchFileId,
      wires: [expect.objectContaining({ label: "SENSE" })],
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DesignDocUpdated",
        actorType: "AGENT",
        payload: { kind: "CIRCUIT" },
      }),
    );
    expect(requireProjectCapability).toHaveBeenCalledWith(
      "user-1",
      "project-1",
      "electronics.edit",
    );
  });

  it("requires explicit removal instead of silently replacing stable schematic identities", async () => {
    designFindUnique.mockResolvedValue({ data: prior });
    const tool = buildProjectTools(context).save_circuit;
    const renamed = tool.inputSchema.parse({
      parts: [{ ...prior.parts[0], id: "guessed-new-id" }],
      wires: [],
    });
    expect(await tool.execute(renamed)).toMatchObject({
      error: expect.stringContaining("removedPartIds"),
    });
    expect(designUpsert).not.toHaveBeenCalled();

    const removed = tool.inputSchema.parse({ parts: [], wires: [], removedPartIds: ["r"] });
    expect(await tool.execute(removed)).toMatchObject({ ok: true });
    expect(designUpsert.mock.calls[0]?.[0].update.data.parts).toEqual([]);
  });

  it("rejects duplicate part IDs and wires to nonexistent parts", async () => {
    const tool = buildProjectTools(context).save_circuit;
    expect(
      await tool.execute(
        tool.inputSchema.parse({ parts: [prior.parts[0], prior.parts[0]], wires: [] }),
      ),
    ).toHaveProperty("error");
    expect(
      await tool.execute(
        tool.inputSchema.parse({
          parts: prior.parts,
          wires: [{ id: "bad", from: { part: "absent", pin: "1" }, to: { part: "r", pin: "1" } }],
        }),
      ),
    ).toHaveProperty("error");
    expect(designUpsert).not.toHaveBeenCalled();
  });

  it("supports explicit metadata and net label clearing", async () => {
    designFindUnique.mockResolvedValue({ data: prior });
    const tool = buildProjectTools(context).save_circuit;
    const input = tool.inputSchema.parse({
      parts: prior.parts,
      wires: prior.wires.map((wire) => ({ ...wire, label: null })),
      groups: [],
      sketchFileId: null,
    });
    await tool.execute(input);
    const saved = designUpsert.mock.calls[0]?.[0].update.data;
    expect(saved.groups).toEqual([]);
    expect(saved.sketchFileId).toBeUndefined();
    expect(saved.wires[0].label).toBeUndefined();
  });

  it("preserves sibling boards and copper without mutating mechanical CAD on PCB save", async () => {
    const existing = {
      version: 2,
      activeBoardId: "b",
      boards: [
        { id: "a", name: "Power", board: { widthMm: 40, heightMm: 30 }, footprints: [] },
        {
          id: "b",
          name: "Main",
          groupId: "board",
          board: { widthMm: 70, heightMm: 50 },
          footprints: [],
          tracks: [
            {
              id: "t",
              layer: "F.Cu",
              widthMm: 0.3,
              points: [
                { xMm: 1, yMm: 1 },
                { xMm: 2, yMm: 2 },
              ],
            },
          ],
          vias: [],
          zones: [],
        },
      ],
    };
    designFindUnique
      .mockResolvedValueOnce({ data: existing })
      .mockResolvedValueOnce({ data: prior });
    const tool = buildProjectTools(context).save_pcb;
    const input = tool.inputSchema.parse({
      boardId: "b",
      board: { widthMm: 75, heightMm: 55 },
      footprints: [],
    });

    const result = await tool.execute(input);

    expect(result).toMatchObject({
      ok: true,
      boards: 2,
      nextStep: expect.stringContaining("sync_pcb_to_cad"),
    });
    const saved = designUpsert.mock.calls[0]?.[0].update.data;
    expect(saved.boards[0]).toMatchObject(existing.boards[0]!);
    expect(saved.boards[1]).toMatchObject({
      id: "b",
      groupId: "board",
      tracks: existing.boards[1]!.tracks,
    });
    expect(mutateModel3dDoc).not.toHaveBeenCalled();
    expect(requireProjectCapability).toHaveBeenCalledWith(
      "user-1",
      "project-1",
      "electronics.edit",
    );
  });

  it("retains known height and pin mapping on placement-only AI edits", async () => {
    const footprint = {
      id: "d1",
      libraryId: "LED_0805",
      refDes: "D1",
      partId: "led",
      pinMap: { A: "1", C: "2" },
      bodyHeightMm: 1.2,
      xMm: 10,
      yMm: 10,
      rotationDeg: 0,
      side: "front",
    };
    designFindUnique
      .mockResolvedValueOnce({ data: { footprints: [footprint] } })
      .mockResolvedValueOnce(null);
    const tool = buildProjectTools(context).save_pcb;
    const { bodyHeightMm: _height, pinMap: _map, ...placement } = footprint;
    await tool.execute(
      tool.inputSchema.parse({
        board: { widthMm: 80, heightMm: 50 },
        footprints: [{ ...placement, xMm: 20 }],
      }),
    );
    expect(designUpsert.mock.calls[0]?.[0].update.data.boards[0].footprints[0]).toMatchObject({
      xMm: 20,
      bodyHeightMm: 1.2,
      pinMap: { A: "1", C: "2" },
    });
  });
});

const SOURCE = "from build123d import Box\nwidth = 10\nresult = Box(width, 10, 10)\n";
function generated(source = SOURCE, id = "resp_python") {
  return async (_prompt: string, options: { focusPath: string }) => ({
    ok: true,
    data: { files: { [options.focusPath]: source }, id },
  });
}
function savedDocument(doc = pythonCadDoc()) {
  let saved = doc;
  designFindUnique.mockImplementation(async () => ({ data: saved }));
  mutateModel3dDoc.mockImplementation(
    (_project: string, _branch: string, _user: string, mutate: (doc: CadDoc) => CadDoc) => {
      saved = mutate(saved);
      return saved;
    },
  );
  return () => saved;
}

describe("Astra native Python CAD integration", () => {
  it("requires a prompt or parts and ignores obsolete Zoo operation fields", () => {
    const schema = buildProjectTools(context).text_to_cad.inputSchema;
    expect(schema.safeParse({ zooOpId: "old-operation" }).success).toBe(false);
    expect(schema.parse({ prompt: "A 10 mm cube", zooOpId: "old-operation" })).toEqual({
      prompt: "A 10 mm cube",
    });
  });

  it("saves a verified native batch once while preserving legacy source and streaming only previews", async () => {
    const legacy = upsertPartScripts(cadDoc(""), [{ partName: "old", script: "oldSolid = 1" }]);
    const saved = savedDocument(legacy);
    const drafts = vi.fn();
    generate.mockImplementation(
      async (
        prompt: string,
        options: { focusPath: string; onDraft: (file: { path: string; content: string }) => void },
      ) => {
        options.onDraft({ path: options.focusPath, content: "from build123d import" });
        expect(evaluate).not.toHaveBeenCalled();
        return generated(SOURCE, `resp_${prompt.slice(0, 3)}`)(prompt, options);
      },
    );
    const signal = new AbortController().signal;
    const result = await buildProjectTools({ ...context, onCadDraft: drafts }).text_to_cad.execute(
      {
        parts: [
          { partName: "housing", prompt: "Housing 10 mm wide" },
          { partName: "lid", prompt: "Lid 10 mm wide" },
        ],
      },
      { toolCallId: "batch", abortSignal: signal },
    );
    expect(result).toMatchObject({
      ok: true,
      engine: "build123d",
      language: "python",
      generated: 2,
      verificationState: "UNVERIFIED",
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]?.[1]).toMatchObject({
      focusPath: "parts/housing/main.py",
      projectName: context.projectId,
      signal,
    });
    expect(drafts).toHaveBeenCalledTimes(2);
    expect(drafts.mock.calls[0]?.[0]).toMatchObject({
      path: "parts/housing/main.py",
      content: "from build123d import",
    });
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate.mock.calls[0]?.[3]).toBe(signal);
    expect(mutateModel3dDoc).toHaveBeenCalledOnce();
    expect(saved().components.find((part) => part.path === "parts/housing/main.py")?.content).toBe(
      SOURCE,
    );
    expect(saved().components.find((part) => part.path.endsWith("old/main.kcl"))?.content).toBe(
      "oldSolid = 1",
    );
    expect(storagePut).not.toHaveBeenCalled();
    expect(legacyCad).not.toHaveBeenCalled();
    expect(onCadProgressEnd).toHaveBeenCalledWith("batch");
    expect(requireProjectCapability).toHaveBeenCalledWith("user-1", "project-1", "mechanical.edit");
  });

  it("repairs the exact failed Python file with the local execution error", async () => {
    savedDocument();
    generate
      .mockImplementationOnce(generated("result = broken()", "bad"))
      .mockImplementationOnce(generated(SOURCE, "fixed"));
    evaluate.mockRejectedValueOnce(new Error("NameError: broken is not defined"));
    const result = await buildProjectTools(context).text_to_cad.execute(
      { prompt: "A recorder enclosure", partName: "base" },
      { toolCallId: "repair" },
    );
    expect(result).toMatchObject({
      ok: true,
      operationId: "fixed",
      parts: [expect.objectContaining({ verified: true, attempts: 2 })],
    });
    expect(generate.mock.calls[1]?.[0]).toContain("NameError: broken is not defined");
    expect(generate.mock.calls[1]?.[1]).toMatchObject({
      files: { "parts/base/main.py": "result = broken()" },
      focusPath: "parts/base/main.py",
    });
    expect(mutateModel3dDoc).toHaveBeenCalledOnce();
  });

  it("keeps a prior native part on repeated failure and saves successful siblings", async () => {
    const saved = savedDocument(upsertPythonPart(pythonCadDoc(), "base", SOURCE));
    generate.mockImplementation(async (prompt: string, options: { focusPath: string }) =>
      generated(prompt.includes("base") ? "result = broken()" : SOURCE)(prompt, options),
    );
    evaluate.mockImplementation(async (doc: CadDoc, id: string) => {
      if (doc.components.find((part) => part.id === id)?.content.includes("broken"))
        throw new Error("Invalid solid");
      return { valid: true, solidCount: 1, volumeMm3: 1000, bbox: {} };
    });
    const result = await buildProjectTools(context).text_to_cad.execute(
      {
        parts: [
          { partName: "base", prompt: "A base enclosure" },
          { partName: "lid", prompt: "A lid enclosure" },
        ],
      },
      { toolCallId: "partial" },
    );
    expect(result).toMatchObject({
      ok: true,
      generated: 1,
      failed: [{ partName: "base", attempts: 2, error: "Invalid solid" }],
    });
    expect(saved().components.find((part) => part.path === "parts/base/main.py")?.content).toBe(
      SOURCE,
    );
    expect(saved().components.find((part) => part.path === "parts/lid/main.py")?.content).toBe(
      SOURCE,
    );
  });

  it("rejects an all-invalid batch without saving or making geometry claims", async () => {
    savedDocument();
    generate.mockImplementation(generated("result = None"));
    evaluate.mockResolvedValue({ valid: false, solidCount: 0 });
    const result = await buildProjectTools(context).text_to_cad.execute(
      { prompt: "A recorder enclosure" },
      { toolCallId: "invalid" },
    );
    expect(result).toMatchObject({
      failed: [{ attempts: 2, error: expect.stringContaining("no valid solid") }],
    });
    expect(mutateModel3dDoc).not.toHaveBeenCalled();
    expect(markDownstreamStale).not.toHaveBeenCalled();
  });

  it("does not retry timeouts or save cancellation results", async () => {
    savedDocument();
    generate.mockImplementation(generated());
    evaluate.mockRejectedValueOnce(new Error("Python CAD timed out"));
    const result = await buildProjectTools(context).text_to_cad.execute(
      { prompt: "A recorder enclosure" },
      { toolCallId: "timeout" },
    );
    expect(result).toMatchObject({ failed: [{ attempts: 1, error: "Python CAD timed out" }] });
    expect(generate).toHaveBeenCalledOnce();
    expect(mutateModel3dDoc).not.toHaveBeenCalled();
    const controller = new AbortController();
    evaluate.mockImplementation(
      (_doc: CadDoc, _id: string, _project: string, signal: AbortSignal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ valid: true, solidCount: 1 }), {
            once: true,
          });
        }),
    );
    const pending = buildProjectTools(context).text_to_cad.execute(
      { prompt: "A recorder enclosure" },
      { toolCallId: "cancel", abortSignal: controller.signal },
    );
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(2));
    controller.abort();
    expect(await pending).toMatchObject({ error: "main: CAD generation cancelled" });
    expect(mutateModel3dDoc).not.toHaveBeenCalled();
  });

  it("never starts a cancelled generation or overwrites files the model added outside the focus", async () => {
    const saved = savedDocument();
    const controller = new AbortController();
    controller.abort();
    await buildProjectTools(context).text_to_cad.execute(
      { prompt: "A recorder enclosure" },
      { toolCallId: "cancelled", abortSignal: controller.signal },
    );
    expect(generate).not.toHaveBeenCalled();
    generate.mockImplementation(async (_prompt: string, options: { focusPath: string }) => ({
      ok: true,
      data: {
        id: "generated",
        files: { [options.focusPath]: SOURCE, "parts/unrelated.py": "result = malicious()" },
      },
    }));
    await buildProjectTools(context).text_to_cad.execute(
      { prompt: "A recorder enclosure", partName: "base" },
      { toolCallId: "focused" },
    );
    expect(saved().components.some((part) => part.path === "parts/unrelated.py")).toBe(false);
    expect(saved().components.find((part) => part.path === "parts/base/main.py")?.content).toBe(
      SOURCE,
    );
  });

  it("reports model-generation and local-execution time separately", async () => {
    savedDocument();
    let now = 1000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    generate.mockImplementation(async (prompt: string, options: { focusPath: string }) => {
      now += 130000;
      return generated()(prompt, options);
    });
    evaluate.mockImplementation(async () => {
      now += 1900;
      return { valid: true, solidCount: 1, volumeMm3: 1000, bbox: {} };
    });
    try {
      const result = await buildProjectTools(context).text_to_cad.execute(
        { prompt: "A recorder enclosure" },
        { toolCallId: "timing" },
      );
      expect(result).toMatchObject({ parts: [{ generationMs: 130000, verificationMs: 1900 }] });
    } finally {
      clock.mockRestore();
    }
  });

  it("saves python_cad as editable source without uploading an STL import wrapper", async () => {
    const saved = savedDocument();
    const result = await buildProjectTools(context).python_cad.execute(
      { partName: "base", script: SOURCE },
      { toolCallId: "python" },
    );
    expect(result).toMatchObject({
      ok: true,
      engine: "build123d",
      language: "python",
      path: "parts/base/main.py",
      verified: true,
    });
    expect(saved().components.find((part) => part.path === "parts/base/main.py")?.content).toBe(
      SOURCE,
    );
    expect(saved().assets ?? []).toEqual([]);
    expect(storagePut).not.toHaveBeenCalled();
    expect(legacyCad).not.toHaveBeenCalled();
  });

  it("rejects invalid native saves and patches before altering the current file", async () => {
    const saved = savedDocument(upsertPythonPart(pythonCadDoc(), "base", SOURCE));
    evaluate.mockRejectedValue(new Error("Invalid fillet"));
    const tools = buildProjectTools(context);
    expect(
      await tools.save_cad_script.execute({ partName: "base", script: "result = broken()" }),
    ).toHaveProperty("error");
    expect(
      await tools.patch_cad_script.execute(
        { partName: "base", edits: [{ find: "width = 10", replace: "width = -10" }] },
        { toolCallId: "patch" },
      ),
    ).toHaveProperty("error");
    expect(saved().components.find((part) => part.path === "parts/base/main.py")?.content).toBe(
      SOURCE,
    );
    expect(mutateModel3dDoc).not.toHaveBeenCalled();
  });

  it("preserves an intervening collaborator edit instead of committing a stale patch", async () => {
    let current = upsertPythonPart(pythonCadDoc(), "base", SOURCE);
    designFindUnique.mockResolvedValue({ data: current });
    mutateModel3dDoc.mockImplementation(
      (_p: string, _b: string, _u: string, mutate: (doc: CadDoc) => CadDoc) => mutate(current),
    );
    evaluate.mockImplementation(async () => {
      current = upsertPythonPart(current, "base", SOURCE.replace("width = 10", "width = 30"));
      return { valid: true, solidCount: 1 };
    });
    const result = await buildProjectTools(context).patch_cad_script.execute(
      { partName: "base", edits: [{ find: "width = 10", replace: "width = 20" }] },
      { toolCallId: "conflict" },
    );
    expect(result).toMatchObject({ error: expect.stringContaining("source changed") });
    expect(
      current.components.find((part) => part.path === "parts/base/main.py")?.content,
    ).toContain("width = 30");
  });

  it("uses the Three.js render route without trying Zoo snapshots", async () => {
    screenshot.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const signal = new AbortController().signal;
    const result = await buildProjectTools(context).render_model_views.execute(
      { views: ["iso"] },
      { toolCallId: "view", abortSignal: signal },
    );
    expect(result).toMatchObject({ ok: true, source: "viewport", images: [{ view: "iso" }] });
    expect(screenshot).toHaveBeenCalledWith(
      expect.stringContaining("/render/model3d?"),
      expect.objectContaining({ requireReady: true, signal }),
    );
    expect(legacyCad).not.toHaveBeenCalled();
  });

  it("creates native components only after supplied source executes, preserving legacy files", async () => {
    const legacy = upsertPartScripts(cadDoc(""), [{ partName: "old", script: "oldSolid = 1" }]);
    const saved = savedDocument(legacy);
    const tool = buildProjectTools(context).create_cad_component;
    const input = { name: "base", kind: "part" as const, content: SOURCE };
    evaluate.mockRejectedValueOnce(new Error("Kernel unavailable"));
    expect(await tool.execute(input)).toMatchObject({
      error: expect.stringContaining("Nothing saved"),
    });
    expect(saved()).toBe(legacy);
    expect(mutateModel3dDoc).not.toHaveBeenCalled();
    expect(await tool.execute(input)).toMatchObject({ ok: true });
    expect(saved().engine).toBe("build123d");
    expect(saved().components).toEqual(expect.arrayContaining(legacy.components));
    expect(saved().components.find((part) => part.path === "parts/base/main.py")?.content).toBe(
      SOURCE,
    );
    expect(legacyCad).not.toHaveBeenCalled();
  });

  it("does not create a component when cancellation arrives during local execution", async () => {
    const before = pythonCadDoc();
    const saved = savedDocument(before);
    const controller = new AbortController();
    evaluate.mockImplementation(async () => {
      controller.abort();
      return { valid: true, solidCount: 1 };
    });
    expect(
      await buildProjectTools(context).create_cad_component.execute(
        { name: "base", kind: "part", content: SOURCE },
        { abortSignal: controller.signal },
      ),
    ).toHaveProperty("error");
    expect(saved()).toBe(before);
    expect(mutateModel3dDoc).not.toHaveBeenCalled();
  });

  it("links existing native source while retaining exact saved instance poses", async () => {
    const withParts = upsertPythonPart(
      upsertPythonPart(pythonCadDoc(), "base", SOURCE),
      "lid",
      SOURCE,
    );
    const base = withParts.components.find((part) => part.path === "parts/base/main.py")!;
    const lid = withParts.components.find((part) => part.path === "parts/lid/main.py")!;
    const placed: CadAssemblyInstance = {
      id: "placed-base",
      componentId: base.id,
      translationMm: { x: 12, y: 5, z: 3 },
      rotationDeg: { x: 0, y: 0, z: 90 },
      visible: true,
      fixed: true,
    };
    const cad = buildLinkedAssembly(withParts, [placed]);
    getEngineeringStatus.mockResolvedValue({ cad, fingerprint: "current" });
    let assembled = cad;
    updateEngineering.mockImplementation(
      async (_ctx, input: { instances: CadAssemblyInstance[] }) => {
        assembled = buildLinkedAssembly(cad, input.instances);
        return { cad: assembled, fingerprint: "next" };
      },
    );
    const result = await buildProjectTools(context).add_part_to_assembly.execute(
      { parts: [lid.path], includePcb: false },
      { toolCallId: "assemble" },
    );
    expect(result).toMatchObject({
      ok: true,
      assembly: "assembly/product.py",
      verificationState: "UNVERIFIED",
    });
    expect(updateEngineering).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
      expect.objectContaining({
        action: "build_linked_assembly",
        expectedFingerprint: "current",
        instances: [
          placed,
          expect.objectContaining({ componentId: lid.id, translationMm: { x: 0, y: 0, z: 0 } }),
        ],
      }),
    );
    const source = assembled.components.find(
      (part) => part.path === "assembly/product.py",
    )!.content;
    expect(source).toContain("parts.base.main");
    expect(source).toContain("parts.lid.main");
    expect(assembled.components.find((part) => part.id === base.id)?.content).toBe(SOURCE);
    expect(generate).not.toHaveBeenCalled();
    expect(legacyCad).not.toHaveBeenCalled();
  });

  it("preserves explicit legacy assembly references rather than silently dropping them", async () => {
    const legacy = upsertPartScripts(cadDoc(""), [{ partName: "old", script: "oldSolid = 1" }]);
    const cad = upsertPythonPart(legacy, "new", SOURCE);
    const old = cad.components.find((part) => part.path === "parts/old/main.kcl")!;
    const assembly = {
      version: 1 as const,
      instances: [
        {
          id: "legacy-placement",
          componentId: old.id,
          translationMm: { x: 12, y: 5, z: 3 },
          rotationDeg: { x: 0, y: 0, z: 90 },
          visible: true,
          fixed: true,
        },
      ],
    };
    getEngineeringStatus.mockResolvedValue({ cad: { ...cad, assembly }, fingerprint: "current" });
    const result = await buildProjectTools(context).add_part_to_assembly.execute(
      { parts: ["new"], includePcb: false },
      { toolCallId: "assemble" },
    );
    expect(result).toMatchObject({
      error: expect.stringContaining("Existing placement is unchanged"),
    });
    expect(updateEngineering).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
