import { describe, expect, it } from "vitest";
import {
  cadDoc,
  importMeshAsPart,
  insertPartIntoAssembly,
  toZooKclPath,
  type CadDoc,
} from "@/lib/cad/engine";
import { cadViewportInput } from "@/lib/cad/viewport-project";

function partOf(doc: CadDoc) {
  return doc.components.find((c) => c.kind === "part")!;
}

function assemblyOf(doc: CadDoc) {
  return doc.components.find((c) => c.kind === "assembly")!;
}

describe("cadViewportInput", () => {
  it("submits a standalone part as a single file", () => {
    const doc = cadDoc("width = 40\nbody = 1\n");
    const part = partOf(doc);

    const input = cadViewportInput(doc, part.id)!;

    expect(input.script).toContain("width = 40");
    expect(input.projectFiles).toBeUndefined();
    expect(input.entryPath).toBeUndefined();
    expect(input.foreignImportOnly).toBe(false);
  });

  it("submits an assembly as a multi-file project so its imports resolve", () => {
    let doc = cadDoc("width = 10\nbox = 1\n");
    const part = partOf(doc);
    const assembly = assemblyOf(doc);
    doc = insertPartIntoAssembly(doc, assembly.id, part.id);

    const input = cadViewportInput(doc, assembly.id)!;

    expect(input.entryPath).toBe(toZooKclPath(assembly.path));
    expect(input.projectFiles).toBeDefined();
    // The imported part must travel with the entry, or the engine renders nothing.
    expect(input.projectFiles![toZooKclPath(part.path)]).toContain("width = 10");
    expect(input.projectFiles![input.entryPath!]).toContain(`import "${toZooKclPath(part.path)}"`);
  });

  it("keeps every workspace part in the submitted file map", () => {
    let doc = cadDoc("a = 1\n");
    const assembly = assemblyOf(doc);
    doc = insertPartIntoAssembly(doc, assembly.id, partOf(doc).id);

    const input = cadViewportInput(doc, assembly.id)!;
    const zooPaths = doc.components
      .filter((c) => c.kind !== "instructions")
      .map((c) => toZooKclPath(c.path));

    expect(Object.keys(input.projectFiles!).sort()).toEqual(zooPaths.sort());
  });

  it("exposes mesh assets for a foreign-import part and skips the KCL submit", () => {
    const doc = importMeshAsPart(cadDoc("x = 1\n"), {
      name: "housing",
      path: "imports/housing.stl",
      format: "stl",
      storageKey: "projects/p1/cad/imports/housing.stl",
      sizeBytes: 2048,
      lengthUnit: "mm",
    });
    const meshPart = doc.components.find((c) => c.name === "housing")!;

    const input = cadViewportInput(doc, meshPart.id)!;

    expect(input.foreignImportOnly).toBe(true);
    expect(input.meshAssets).toEqual([
      {
        path: "imports/housing.stl",
        format: "stl",
        fileUrl: "/api/files/projects/p1/cad/imports/housing.stl",
        lengthUnit: "mm",
      },
    ]);
  });

  it("returns nothing to render for instructions", () => {
    const doc = cadDoc("x = 1\n");
    const instructions = doc.components.find((c) => c.kind === "instructions")!;

    expect(cadViewportInput(doc, instructions.id)).toBeNull();
  });
});
