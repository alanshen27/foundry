import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cadDoc, upsertPartScript, type CadPort } from "@foundry/cad";
import { assembleProductWithZooMcp } from "@/server/assemble-product";
import { normalizePcbSet } from "@/lib/pcb/doc";

const PART = "housingWidth = 40\n// authoritative manufacturing source";
const PREVIEW =
  '// UNVERIFIED product preview\nimport "parts/housing/main.kcl" as housing\nhousing\n';

function fixture() {
  const doc = upsertPartScript(cadDoc(""), "housing", PART);
  const assembly = doc.components.find((c) => c.kind === "assembly")!;
  const parts = doc.components.filter((c) => c.name === "housing");
  return { doc, assembly, parts };
}

const cad: CadPort = {
  textToCad: vi.fn(),
  textToCadProject: vi.fn(),
  iterateCad: vi.fn(),
  iterateCadProject: vi.fn(),
  executeKcl: vi.fn(),
  boundingBoxKcl: vi.fn(),
  multiviewSnapshotKcl: vi.fn(),
  exportGlb: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cad.iterateCadProject).mockResolvedValue({
    ok: true,
    data: {
      id: "resp_astra_assembly",
      files: {
        "main.kcl": PREVIEW,
        "parts/housing/main.kcl": "// provider rewrite must never replace manufacturing source",
      },
    },
  });
  vi.mocked(cad.executeKcl).mockResolvedValue({ ok: true, data: { message: "KCL executes" } });
});

describe("assembleProductWithZooMcp", () => {
  it("synchronizes every board in a set with its own dimensions", async () => {
    const input = fixture();
    const pcb = normalizePcbSet({
      version: 2,
      boards: [
        { id: "main", name: "Main", board: { widthMm: 60, heightMm: 40, thicknessMm: 1.6 } },
        { id: "sensor", name: "Sensor", board: { widthMm: 20, heightMm: 10, thicknessMm: 0.8 } },
      ],
    });
    const result = await assembleProductWithZooMcp({ cad, ...input, pcb });
    const boards = result.doc.components.filter((c) => c.source?.kind === "pcb");
    expect(boards).toHaveLength(2);
    expect(boards.find((c) => c.source!.boardId === "main")!.content).toContain("width = 60");
    expect(boards.find((c) => c.source!.boardId === "sensor")!.content).toContain("width = 20");
    const files = vi.mocked(cad.iterateCadProject).mock.calls[0]![0];
    for (const board of boards) expect(files[board.path]).toBe(board.content);
    expect(result.placed).toHaveLength(3);
  });

  it("changes only the preview, keeps references immutable, and verifies the assembled project", async () => {
    const input = fixture();
    const before = structuredClone(input);
    const signal = new AbortController().signal;
    const onProgress = vi.fn();
    vi.mocked(cad.executeKcl).mockImplementation(async ({ projectDir }) => {
      expect(await readFile(join(projectDir!, "main.kcl"), "utf8")).toBe(PREVIEW);
      expect(await readFile(join(projectDir!, "parts/housing/main.kcl"), "utf8")).toBe(PART);
      return { ok: true, data: { message: "KCL executes" } };
    });

    const result = await assembleProductWithZooMcp({ cad, ...input, signal, onProgress });

    expect(cad.iterateCadProject).toHaveBeenCalledWith(
      expect.objectContaining({ "parts/housing/main.kcl": PART }),
      expect.stringContaining("MANUFACTURING references"),
      { focusPath: "main.kcl", signal, onProgress, onDraft: expect.any(Function) },
    );
    expect(result.doc.components.find((c) => c.id === input.parts[0]!.id)?.content).toBe(PART);
    expect(result.doc.components.find((c) => c.id === input.assembly.id)?.content).toBe(PREVIEW);
    expect(result.doc.activeId).toBe(input.assembly.id);
    expect(result.doc.engine).toBe("zoo");
    expect(result).toMatchObject({
      operationId: "resp_astra_assembly",
      placed: [{ path: input.parts[0]!.path }],
      executeMessage: "KCL executes",
      warnings: [],
    });
    expect(result).not.toHaveProperty("zooOpId");
    expect(input).toEqual(before);
    expect(onProgress).toHaveBeenCalledWith("Validating the assembly in the engine");
    expect(cad.executeKcl).toHaveBeenCalledOnce();
  });

  it("returns validation warnings without claiming engine success", async () => {
    vi.mocked(cad.executeKcl).mockResolvedValue({ ok: false, error: "Engine unavailable" });

    const result = await assembleProductWithZooMcp({ cad, ...fixture() });

    expect(result.operationId).toBe("resp_astra_assembly");
    expect(result.executeMessage).toBe("CAD assembly validation failed.");
    expect(result.warnings).toContain(result.executeMessage);
  });

  it("validates a self-contained preview without submitting unused manufacturing references", async () => {
    const input = fixture();
    const before = structuredClone(input);
    const standalone = "// UNVERIFIED self-contained preview\nhousingWidth = 40\n";
    vi.mocked(cad.iterateCadProject).mockResolvedValue({
      ok: true,
      data: {
        id: "resp_standalone",
        files: {
          "main.kcl": standalone,
          "parts/housing/main.kcl": "// ignored provider rewrite",
        },
      },
    });
    vi.mocked(cad.executeKcl).mockImplementation(async ({ projectDir }) => {
      expect(await readFile(join(projectDir!, "main.kcl"), "utf8")).toBe(standalone);
      await expect(
        readFile(join(projectDir!, "parts/housing/main.kcl"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      return { ok: true, data: { message: "KCL executes" } };
    });

    const result = await assembleProductWithZooMcp({ cad, ...input });

    // Generation still receives the reference; pruning only affects engine execution.
    expect(vi.mocked(cad.iterateCadProject).mock.calls[0]![0]["parts/housing/main.kcl"]).toBe(PART);
    expect(result.doc.components.find((part) => part.id === input.parts[0]!.id)?.content).toBe(
      PART,
    );
    expect(result.doc.components.find((part) => part.id === input.assembly.id)?.content).toBe(
      standalone,
    );
    expect(result.warnings).toEqual([]);
    expect(cad.executeKcl).toHaveBeenCalledOnce();
    expect(input).toEqual(before);
  });

  it("does not execute or mutate the input when generation fails", async () => {
    const input = fixture();
    const before = structuredClone(input);
    vi.mocked(cad.iterateCadProject).mockResolvedValue({ ok: false, error: "Astra unavailable" });

    await expect(assembleProductWithZooMcp({ cad, ...input })).rejects.toThrow(
      "CAD assembly generation failed.",
    );

    expect(input).toEqual(before);
    expect(cad.executeKcl).not.toHaveBeenCalled();
  });

  it.each(["missing", "empty", "unchanged"])("rejects %s preview output", async (kind) => {
    vi.mocked(cad.iterateCadProject).mockImplementation(async (files) => {
      const outputs: Record<string, string> = {};
      if (kind !== "missing") outputs["main.kcl"] = kind === "empty" ? "  " : files["main.kcl"]!;
      return { ok: true, data: { id: "resp_empty", files: outputs } };
    });

    await expect(assembleProductWithZooMcp({ cad, ...fixture() })).rejects.toThrow(
      "Astra returned no product preview KCL",
    );
    expect(cad.executeKcl).not.toHaveBeenCalled();
  });

  it("rejects assemblies without usable manufacturing references", async () => {
    const input = fixture();
    input.parts = input.parts.map((part) => ({ ...part, content: " " }));

    await expect(assembleProductWithZooMcp({ cad, ...input })).rejects.toThrow(
      "No parts available to assemble",
    );
    expect(cad.iterateCadProject).not.toHaveBeenCalled();
  });
});
