import { describe, expect, it } from "vitest";
import {
  buildKclProject,
  cadDoc,
  importMeshAsPart,
  normalizeCadDoc,
  removeCadComponents,
  updateComponentContent,
  upsertPartScript,
} from "../src/doc";
import { buildLinkedAssembly, linkedAssemblyStatus, stableCadHash } from "../src/linked-assembly";

describe("linked manufacturing assembly", () => {
  it("fingerprints object keys canonically without conflating array order", () => {
    expect(stableCadHash({ b: 2, a: [1, { z: 3, y: 4 }] })).toBe(
      stableCadHash({ a: [1, { y: 4, z: 3 }], b: 2 }),
    );
    expect(stableCadHash([1, 2])).not.toBe(stableCadHash([2, 1]));
    expect(stableCadHash({ a: 1, absent: undefined })).toBe(stableCadHash({ a: 1 }));
  });

  it("builds real imports without touching manufacturing source and preserves existing poses", () => {
    const original = upsertPartScript(cadDoc("width = 20"), "lid", "width = 22");
    const input = structuredClone(original);
    const built = buildLinkedAssembly(original);
    expect(original).toEqual(input);
    expect(built.components.filter((c) => c.kind === "part")).toEqual(
      original.components.filter((c) => c.kind === "part"),
    );
    expect(built.script).toContain('import "parts/main.kcl" as source1');
    expect(built.script).toContain('import "parts/lid/main.kcl" as source2');
    expect(built.script).toContain("UNVERIFIED placement");
    expect(built.script).not.toContain("extrude");
    const instances = built.assembly!.instances.map((i, index) => ({
      ...i,
      translationMm: { x: index * 10, y: 3, z: 5 },
      rotationDeg: { x: 90, y: 30, z: 45 },
    }));
    const posed = buildLinkedAssembly(built, instances);
    expect(posed.script).toContain("angle = 90deg, global = true");
    expect(posed.script).toContain("x = 10mm, y = 3mm, z = 5mm, global = true");
    expect(
      buildLinkedAssembly(
        upsertPartScript(posed, "screw", "diameter = 3"),
      ).assembly!.instances.slice(0, 2),
    ).toEqual(instances);
    expect(linkedAssemblyStatus(posed)).toEqual({
      linked: true,
      stale: false,
      modified: false,
      missingComponentIds: [],
      unplacedComponentIds: [],
    });
  });

  it("clones before any original moves and omits hidden sources", () => {
    const original = upsertPartScript(cadDoc("body = 1"), "hidden", "body = 2");
    const built = buildLinkedAssembly(original);
    const instances = built.assembly!.instances;
    const duplicate = { ...instances[0]!, id: "copy", translationMm: { x: 10, y: 0, z: 0 } };
    const next = buildLinkedAssembly(built, [
      instances[0]!,
      duplicate,
      { ...instances[1]!, visible: false },
    ]);
    expect(next.script.indexOf("instance2 = clone(source1)")).toBeLessThan(
      next.script.indexOf("placed1 ="),
    );
    expect(next.script).not.toContain('import "parts/hidden/main.kcl"');
    expect(next.assembly!.instances).toHaveLength(3);
  });

  it("distinguishes stale sources, changed poses, preview edits, missing and unplaced parts", () => {
    const built = buildLinkedAssembly(cadDoc("width = 20"));
    const part = built.components.find((c) => c.kind === "part")!;
    expect(
      linkedAssemblyStatus(updateComponentContent(built, part.id, "width = 21")),
    ).toMatchObject({ stale: true, modified: false });
    expect(
      linkedAssemblyStatus(updateComponentContent(built, built.activeId, "// custom assembly")),
    ).toMatchObject({ stale: false, modified: true });
    const moved = structuredClone(built);
    moved.assembly!.instances[0]!.translationMm.z = 5;
    expect(linkedAssemblyStatus(moved).stale).toBe(true);
    expect(linkedAssemblyStatus(removeCadComponents(built, [part.id])).missingComponentIds).toEqual(
      [part.id],
    );
    expect(
      linkedAssemblyStatus(upsertPartScript(built, "new", "height = 1")).unplacedComponentIds,
    ).toHaveLength(1);
  });

  it("round-trips linkage provenance through normalizers and preserves custom content detection", () => {
    const doc = cadDoc("width = 20");
    doc.components[0]!.source = {
      kind: "pcb",
      boardId: "board-1",
      sourceHash: "source",
      generatedHash: stableCadHash(doc.components[0]!.content),
    };
    const built = buildLinkedAssembly(doc);
    expect(normalizeCadDoc(built)).toEqual(built);
    const edited = updateComponentContent(built, doc.components[0]!.id, "width = 30");
    const normalized = normalizeCadDoc(edited);
    expect(normalized.components[0]!.source).toEqual(doc.components[0]!.source);
    expect(linkedAssemblyStatus(normalized).stale).toBe(true);
  });

  it("rejects dangling refs, duplicate instance IDs, and nonfinite transforms", () => {
    const doc = buildLinkedAssembly(cadDoc("body = 1"));
    const instance = doc.assembly!.instances[0]!;
    expect(() => buildLinkedAssembly(doc, [{ ...instance, componentId: "gone" }])).toThrow(
      "missing part",
    );
    expect(() => buildLinkedAssembly(doc, [instance, instance])).toThrow("unique");
    expect(() =>
      buildLinkedAssembly(doc, [{ ...instance, translationMm: { x: NaN, y: 0, z: 0 } }]),
    ).toThrow("finite");
  });

  it("preserves imported geometry and diagnoses only reachable missing assets", () => {
    let doc = importMeshAsPart(cadDoc("body = 1"), {
      id: "asset",
      name: "bracket",
      path: "imports/bracket.stl",
      storageKey: "projects/p/bracket.stl",
      format: "stl",
      sizeBytes: 42,
    });
    const built = buildLinkedAssembly(doc);
    const project = buildKclProject(built, "assembly/product.kcl");
    expect(project.files["parts/bracket/main.kcl"]).toContain('import "imports/bracket.stl"');
    expect(project.files["parts/bracket/main.kcl"]).not.toContain("proxyW");
    expect(project.meshAssets.map((a) => a.id)).toEqual(["asset"]);
    doc = { ...built, assets: [] };
    expect(() => buildKclProject(doc, "assembly/product.kcl")).toThrow(
      "Missing imported CAD asset: imports/bracket.stl",
    );
    expect(() => buildKclProject(doc, "parts/main.kcl")).not.toThrow();
  });
});
