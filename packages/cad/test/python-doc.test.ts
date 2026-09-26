import { describe, expect, it } from "vitest";
import {
  pythonCadDoc,
  cadDoc,
  normalizeCadDoc,
  upsertPythonPart,
  upsertPythonCadContent,
  addCadComponent,
  isCadStarterComponent,
  selectCadComponentId,
  importMeshAsPart,
  assemblyDropTargetId,
  insertPartIntoAssembly,
  pickCadAssemblyPreview,
  upsertCadContent,
} from "../src/doc";
import {
  buildPythonProject,
  pythonProjectDependencies,
  PYTHON_ASSEMBLY_PATH,
  pythonPartPath,
} from "../src/python-project";
import { buildLinkedAssembly, linkedAssemblyStatus } from "../src/linked-assembly";

const box = "from build123d import Box\nresult = Box(10,20,5)\n";
describe("native Python documents", () => {
  it("starts empty, recognizes starters, and defaults new documents to Python", () => {
    const doc = pythonCadDoc();
    expect(normalizeCadDoc(null).engine).toBe("build123d");
    expect(
      doc.components.filter((c) => c.kind !== "instructions").every(isCadStarterComponent),
    ).toBe(true);
    expect(doc.script).not.toContain("Box(");
    expect(normalizeCadDoc(doc)).toEqual(doc);
    const added = upsertPythonPart(doc, "recorder base", box);
    expect(added.components.find((c) => c.id === added.activeId)?.path).toBe(
      "parts/recorder_base/main.py",
    );
    expect(selectCadComponentId(added, doc.activeId)).toBe(added.activeId);
    expect(pythonPartPath("123 switch")).toBe("parts/part_123_switch/main.py");
  });
  it("preserves native content including blank drafts and all explicit legacy source", () => {
    const legacy = cadDoc("width = 31\n");
    const next = upsertPythonPart(legacy, "main", box);
    expect(next.engine).toBe("build123d");
    expect(next.components.filter((c) => c.path.endsWith(".kcl"))).toEqual(
      legacy.components.filter((c) => c.path.endsWith(".kcl")),
    );
    expect(normalizeCadDoc(next)).toEqual(next);
    const blank = upsertPythonPart(next, "parts/main.py", "");
    expect(normalizeCadDoc(blank).components.find((c) => c.path === "parts/main.py")?.content).toBe(
      "",
    );
    expect(normalizeCadDoc(legacy)).toEqual(legacy);
  });
  it("adds empty Python components without overwriting legacy assembly", () => {
    const legacy = cadDoc("width = 7");
    const next = addCadComponent(
      { ...legacy, engine: "build123d" },
      { kind: "assembly", name: "product" },
    );
    expect(next.components.find((c) => c.path === "assembly/product.kcl")).toEqual(
      legacy.components.find((c) => c.kind === "assembly"),
    );
    expect(next.components.find((c) => c.path === PYTHON_ASSEMBLY_PATH)).toBeDefined();
    expect(
      addCadComponent(pythonCadDoc(), { kind: "part", name: "small bracket" }).script,
    ).toContain("result = None");
  });
  it("builds only reachable imports including relative modules and package initialization", () => {
    let doc = upsertPythonCadContent(
      pythonCadDoc(box),
      "parts/widget/helpers.py",
      "from .dimensions import width\n",
    );
    doc = upsertPythonCadContent(doc, "parts/widget/dimensions.py", "width = 20\n");
    doc = upsertPythonCadContent(doc, "parts/widget/__init__.py", "# package\n");
    doc = upsertPythonCadContent(
      doc,
      "parts/widget/main.py",
      "from build123d import Box\nfrom .helpers import width\nresult = Box(width,1,1)\n",
    );
    doc = upsertPythonCadContent(
      doc,
      PYTHON_ASSEMBLY_PATH,
      "from parts.widget.main import result\n",
    );
    const project = buildPythonProject(doc, PYTHON_ASSEMBLY_PATH);
    expect(Object.keys(project.files)).toEqual([
      PYTHON_ASSEMBLY_PATH,
      "parts/widget/__init__.py",
      "parts/widget/dimensions.py",
      "parts/widget/helpers.py",
      "parts/widget/main.py",
    ]);
    expect(project.files).not.toHaveProperty("parts/main.py");
    expect(() => buildPythonProject(doc, "absent.py")).toThrow("entry");
    const files = { "main.py": "from parts import missing", "parts/real.py": box };
    expect(() => pythonProjectDependencies(files, "main.py")).toThrow("missing");
  });
  it("handles multiline, aliases and comments without importing text in strings", () => {
    const files = {
      "main.py":
        '"""\nfrom parts.missing import result\n"""\n# import parts.missing\nfrom parts import (\n a as first,\n b\n)\nimport math, parts.c as c\n',
      "parts/a.py": box,
      "parts/b.py": box,
      "parts/c.py": box,
    };
    expect(pythonProjectDependencies(files, "main.py")).toEqual([
      "parts/a.py",
      "parts/b.py",
      "parts/c.py",
    ]);
    expect(
      pythonProjectDependencies(
        { "parts/__init__.py": "# package", "parts/a.py": box },
        "parts/a.py",
      ),
    ).toEqual(["parts/__init__.py"]);
  });
  it("keeps mixed-language drops and explicit legacy writes from corrupting native source", () => {
    const native = upsertPythonPart(cadDoc("width = 31"), "bracket", box);
    const pyPart = native.components.find((c) => c.id === native.activeId)!;
    const legacyAssembly = native.components.find((c) => c.kind === "assembly")!;
    expect(assemblyDropTargetId(native)).toBeNull();
    expect(() => insertPartIntoAssembly(native, legacyAssembly.id, pyPart.id)).toThrow(
      "native Python assembly",
    );
    const built = buildLinkedAssembly(native);
    expect(assemblyDropTargetId(built, pyPart.id)).toBe(built.activeId);
    expect(pickCadAssemblyPreview(built)?.component.path).toBe(PYTHON_ASSEMBLY_PATH);
    const updatedLegacy = upsertCadContent(built, "assembly/product.kcl", "// edited legacy");
    expect(updatedLegacy.components.find((c) => c.path === PYTHON_ASSEMBLY_PATH)?.content).toBe(
      built.script,
    );
    const imported = importMeshAsPart(built, {
      name: "bracket",
      path: "imports/bracket.stl",
      format: "stl",
      storageKey: "projects/p/bracket.stl",
      sizeBytes: 1,
    });
    expect(imported.components.find((c) => c.id === pyPart.id)?.content).toBe(box);
    expect(imported.components.find((c) => c.id === imported.activeId)?.path).toMatch(/\.kcl$/);
  });

  it("preserves authorized STEP assets and legacy mesh wrappers", () => {
    const asset = {
      name: "bracket",
      path: "imports/bracket.step",
      format: "step" as const,
      storageKey: "projects/p/a.step",
      sizeBytes: 123,
    };
    const doc = importMeshAsPart(pythonCadDoc(), asset);
    expect(doc.script).toContain('import_step("imports/bracket.step")');
    const project = buildPythonProject(
      doc,
      doc.components.find((c) => c.id === doc.activeId)!.path,
    );
    expect(project.meshAssets).toHaveLength(1);
    expect(() => buildPythonProject({ ...doc, assets: [] }, project.entryPath)).toThrow(
      "Missing imported CAD asset",
    );
    const mesh = importMeshAsPart(pythonCadDoc(), {
      ...asset,
      path: "imports/bracket.stl",
      format: "stl",
    });
    expect(mesh.components.find((c) => c.id === mesh.activeId)?.path).toMatch(/\.kcl$/);
    expect(mesh.engine).toBe("build123d");
  });
  it("links actual native parts, keeps legacy references, preserves transforms and flags staleness", () => {
    const legacy = cadDoc("width = 7");
    const native = upsertPythonPart(legacy, "bracket", box);
    const built = buildLinkedAssembly(native);
    expect(built.assembly!.instances).toHaveLength(1);
    expect(built.script).toContain("from parts.bracket.main import result as source1");
    expect(built.script).toContain("deepcopy(source1)");
    expect(built.script).not.toContain("Box(");
    expect(linkedAssemblyStatus(built)).toMatchObject({
      linked: true,
      stale: false,
      modified: false,
      unplacedComponentIds: [legacy.components[0]!.id],
    });
    const instance = built.assembly!.instances[0]!;
    const posed = buildLinkedAssembly(built, [
      { ...instance, rotationDeg: { x: 90, y: 20, z: 45 }, translationMm: { x: 7, y: 8, z: 9 } },
    ]);
    expect(posed.script).toContain(".rotate(Axis.X, 90)");
    expect(posed.script).toContain(".translate((7, 8, 9))");
    expect(() =>
      buildLinkedAssembly(built, [{ ...instance, componentId: legacy.components[0]!.id }]),
    ).toThrow("legacy KCL");
    expect(
      linkedAssemblyStatus(upsertPythonPart(built, "bracket", box.replace("10", "11"))).stale,
    ).toBe(true);
  });
});
