import { describe, expect, it } from "vitest";
import {
  cadDoc,
  importMeshAsPart,
  insertPartIntoAssembly,
  toZooKclPath,
  updateComponentContent,
  upsertPartScript,
  pythonCadDoc,
  upsertPythonPart,
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
  it("routes Python parts through build123d with their exact entry file", () => {
    const source = "from build123d import Box\nresult = Box(40, 30, 4)\n";
    const doc = pythonCadDoc(source);
    const part = partOf(doc);
    expect(cadViewportInput(doc, part.id)).toEqual({
      engine: "build123d",
      script: source,
      projectFiles: { [part.path]: source },
      entryPath: part.path,
      meshAssets: [],
      foreignImportOnly: false,
    });
  });

  it("keeps Python assembly dependency snapshots consistent and excludes legacy/unrelated parts", () => {
    let doc = pythonCadDoc("from build123d import Box\nresult = Box(40, 30, 4)\n");
    const base = partOf(doc);
    const assembly = assemblyOf(doc);
    doc = insertPartIntoAssembly(doc, assembly.id, base.id);
    doc = upsertPythonPart(
      doc,
      "spare",
      "from build123d import Cylinder\nresult = Cylinder(5, 2)\n",
    );
    const spare = doc.components.find((c) => c.path === "parts/spare/main.py")!;
    doc = {
      ...doc,
      components: [
        ...doc.components,
        {
          id: "legacy",
          name: "legacy",
          path: "parts/legacy/main.kcl",
          kind: "part",
          content: "width = 10\n",
        },
      ],
    };
    const input = cadViewportInput(doc, assembly.id)!;
    expect(input.engine).toBe("build123d");
    expect(Object.keys(input.projectFiles!).sort()).toEqual([assembly.path, base.path].sort());
    expect(input.projectFiles![base.path]).toBe(base.content);
    expect(
      cadViewportInput(updateComponentContent(doc, spare.id, "result = None\n"), assembly.id),
    ).toEqual(input);
    expect(
      cadViewportInput(
        updateComponentContent(
          doc,
          base.id,
          "from build123d import Box\nresult = Box(42, 30, 4)\n",
        ),
        assembly.id,
      ),
    ).not.toEqual(input);
    expect(doc.components.find((c) => c.id === "legacy")?.content).toBe("width = 10\n");
  });

  it("provides the authenticated STEP asset for native Python imports", () => {
    const doc = importMeshAsPart(pythonCadDoc(), {
      name: "housing",
      path: "imports/housing.step",
      format: "step",
      storageKey: "projects/p1/cad/imports/housing.step",
      sizeBytes: 2048,
    });
    const input = cadViewportInput(doc, doc.activeId)!;
    expect(input.engine).toBe("build123d");
    expect(input.script).toContain('import_step("imports/housing.step")');
    expect(input.meshAssets).toEqual([
      {
        path: "imports/housing.step",
        format: "step",
        fileUrl: "/api/files/projects/p1/cad/imports/housing.step",
      },
    ]);
  });

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

  it("keeps unrelated edits out of an assembly request while reachable edits invalidate it", () => {
    let doc = cadDoc("a = 1\n");
    const assembly = assemblyOf(doc);
    doc = insertPartIntoAssembly(doc, assembly.id, partOf(doc).id);
    doc = upsertPartScript(doc, "unrelated", "width = 10\n");
    const unused = doc.components.find((component) => component.name === "unrelated")!;

    const input = cadViewportInput(doc, assembly.id)!;
    expect(Object.keys(input.projectFiles!).sort()).toEqual(
      [toZooKclPath(assembly.path), toZooKclPath(partOf(doc).path)].sort(),
    );
    const unrelatedChange = updateComponentContent(doc, unused.id, "width = 99\n");
    expect(JSON.stringify(cadViewportInput(unrelatedChange, assembly.id))).toBe(
      JSON.stringify(input),
    );
    const reachableChange = updateComponentContent(doc, partOf(doc).id, "a = 2\n");
    expect(JSON.stringify(cadViewportInput(reachableChange, assembly.id))).not.toBe(
      JSON.stringify(input),
    );
  });

  it("submits named-import parts with only their own dependency closure", () => {
    let doc = cadDoc('import makeShape as make from "parts/shared.kcl" // dependency\nmake()\n');
    const selected = partOf(doc);
    doc = upsertPartScript(doc, "shared", "export fn makeShape() { return 1 }\n");
    doc = upsertPartScript(doc, "other", "width = 10\n");
    const input = cadViewportInput(doc, selected.id)!;
    expect(input.projectFiles).toBeDefined();
    expect(Object.keys(input.projectFiles!).sort()).toEqual([
      "parts/main.kcl",
      "parts/shared/main.kcl",
    ]);
    expect(input.script).toContain('from "parts/shared/main.kcl" // dependency');
    const other = doc.components.find((component) => component.name === "other")!;
    expect(
      cadViewportInput(updateComponentContent(doc, other.id, "width = 25\n"), selected.id),
    ).toEqual(input);
    const shared = doc.components.find((component) => component.name === "shared")!;
    expect(
      cadViewportInput(
        updateComponentContent(doc, shared.id, "export fn makeShape() { return 2 }\n"),
        selected.id,
      ),
    ).not.toEqual(input);
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
