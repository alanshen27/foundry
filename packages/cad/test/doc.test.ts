import { describe, expect, it } from "vitest";
import { isPlausibleZooOpId } from "../src/zoo";
import {
  DEFAULT_KCL,
  addCadComponent,
  addCadComponents,
  buildKclProject,
  cadDoc,
  displayNameFromCadPath,
  importMeshAsPart,
  insertPartIntoAssembly,
  isForeignImportOnlyScript,
  kclForForeignImport,
  normalizeCadDoc,
  parseForeignImports,
  parseKclModuleImports,
  removeCadComponents,
  PRODUCT_ASSEMBLY_PATH,
  toZooKclPath,
  fromZooKclPath,
  upsertCadContent,
  upsertPartScript,
  upsertPartScripts,
} from "../src/doc";

describe("displayNameFromCadPath", () => {
  it("uses the part folder for Zoo …/main.kcl paths", () => {
    expect(displayNameFromCadPath("parts/lid/main.kcl")).toBe("lid");
    expect(displayNameFromCadPath("parts/enclosure/main.kcl")).toBe("enclosure");
  });

  it("keeps the root part as main", () => {
    expect(displayNameFromCadPath("parts/main.kcl")).toBe("main");
  });

  it("uses the file stem for assembly and docs", () => {
    expect(displayNameFromCadPath("assembly/product.kcl")).toBe("product");
    expect(displayNameFromCadPath("docs/assembly-instructions.md")).toBe("assembly-instructions");
  });
});

describe("normalizeCadDoc", () => {
  it("migrates v4 Zoo KCL into a multi-component workspace", () => {
    const doc = normalizeCadDoc({ version: 4, engine: "zoo", script: "width = 1\n" });
    expect(doc.version).toBe(5);
    expect(doc.components.some((c) => c.kind === "part")).toBe(true);
    expect(doc.components.some((c) => c.kind === "assembly")).toBe(true);
    expect(doc.components.some((c) => c.kind === "instructions")).toBe(true);
    expect(doc.script).toContain("width = 1");
  });

  it("defaults when empty", () => {
    expect(normalizeCadDoc(null).script).toBe(DEFAULT_KCL);
    expect(normalizeCadDoc(null).components.length).toBeGreaterThanOrEqual(3);
  });

  it("defaults when Zoo doc has an empty script string", () => {
    expect(normalizeCadDoc({ version: 4, engine: "zoo", script: "" }).script).toBe(DEFAULT_KCL);
    expect(normalizeCadDoc({ version: 4, engine: "zoo", script: "   " }).script).toBe(DEFAULT_KCL);
  });

  it("comments out legacy OCCT scripts instead of pretending they are KCL", () => {
    const doc = normalizeCadDoc({
      version: 3,
      engine: "occt",
      script: "function main() { return makeBaseBox(1,1,1); }",
    });
    expect(doc.engine).toBe("zoo");
    expect(doc.script).toContain("previous non-KCL model");
    expect(doc.script).toContain("// function main()");
  });

  it("round-trips v5 docs", () => {
    const created = cadDoc("height = 9\n");
    const again = normalizeCadDoc(created);
    expect(again.components).toHaveLength(created.components.length);
    expect(again.script).toContain("height = 9");
  });
});

describe("upsertPartScript", () => {
  it("updates main part by default", () => {
    const doc = upsertPartScript(cadDoc(DEFAULT_KCL), undefined, "width = 99\n");
    const part = doc.components.find((c) => c.path === "parts/main.kcl");
    expect(part?.content).toContain("width = 99");
    expect(doc.activeId).toBe(part?.id);
  });

  it("creates a new named part under parts/<name>/main.kcl", () => {
    const doc = upsertPartScript(cadDoc(DEFAULT_KCL), "lid", "width = 40\n");
    const lid = doc.components.find((c) => c.kind === "part" && c.name === "lid");
    expect(lid?.path).toBe("parts/lid/main.kcl");
  });
});

describe("upsertPartScripts", () => {
  it("lands every part from a parallel generation", () => {
    const doc = upsertPartScripts(cadDoc(DEFAULT_KCL), [
      { partName: "enclosure", script: "encl = 1\n" },
      { partName: "lid", script: "lid = 2\n" },
      { partName: "bracket", script: "brk = 3\n" },
    ]);
    const parts = doc.components.filter((c) => c.kind === "part");
    expect(parts.map((c) => c.name)).toEqual(
      expect.arrayContaining(["main", "enclosure", "lid", "bracket"]),
    );
    expect(parts.find((c) => c.name === "enclosure")?.content).toContain("encl = 1");
    expect(parts.find((c) => c.name === "lid")?.content).toContain("lid = 2");
    expect(parts.find((c) => c.name === "bracket")?.content).toContain("brk = 3");
  });

  it("updates existing parts in place and activates the last one", () => {
    const first = upsertPartScripts(cadDoc(DEFAULT_KCL), [
      { partName: "lid", script: "lid = 1\n" },
    ]);
    const second = upsertPartScripts(first, [
      { partName: "lid", script: "lid = 9\n" },
      { partName: undefined, script: "main = 5\n" },
    ]);
    expect(second.components.filter((c) => c.name === "lid")).toHaveLength(1);
    expect(second.components.find((c) => c.name === "lid")?.content).toContain("lid = 9");
    const active = second.components.find((c) => c.id === second.activeId);
    expect(active?.path).toBe("parts/main.kcl");
    expect(second.script).toContain("main = 5");
  });
});

describe("addCadComponent", () => {
  it("adds instructions without breaking parts", () => {
    const doc = addCadComponent(cadDoc(DEFAULT_KCL), {
      name: "pack-out",
      kind: "instructions",
      content: "# Pack\n",
    });
    expect(doc.components.filter((c) => c.kind === "instructions").length).toBeGreaterThanOrEqual(
      2,
    );
  });
});

describe("addCadComponents", () => {
  it("adds many parts in one pass", () => {
    const doc = addCadComponents(cadDoc(DEFAULT_KCL), [
      { name: "enclosure-shell", kind: "part" },
      { name: "front-lens", kind: "part" },
      { name: "reservoir", kind: "part" },
    ]);
    expect(doc.components.filter((c) => c.kind === "part").map((c) => c.name)).toEqual(
      expect.arrayContaining(["main", "enclosure-shell", "front-lens", "reservoir"]),
    );
  });

  it("stores non-main parts as parts/<name>/main.kcl for Zoo imports", () => {
    const doc = upsertPartScript(cadDoc("x = 1\n"), "enclosure-shell", "width = 1\n");
    const part = doc.components.find((c) => c.name === "enclosure-shell");
    expect(part?.path).toBe("parts/enclosure-shell/main.kcl");
  });
});

describe("assembly part imports", () => {
  it("inserts a whole-module import and replaces the stock envelope", () => {
    const base = cadDoc("width = 40\nbody = 1\n");
    const assembly = base.components.find((c) => c.kind === "assembly")!;
    const part = base.components.find((c) => c.kind === "part")!;
    const next = insertPartIntoAssembly(base, assembly.id, part.id);
    const assy = next.components.find((c) => c.id === assembly.id)!;
    expect(assy.content).not.toContain("assemblyEnvelope = extrude");
    expect(parseKclModuleImports(assy.content)).toEqual(
      expect.arrayContaining([{ path: toZooKclPath(part.path), alias: expect.any(String) }]),
    );
    expect(assy.content).toContain(`import "${toZooKclPath(part.path)}"`);
  });

  it("builds a multi-file project for the assembly entrypoint", () => {
    let doc = cadDoc("width = 10\nbox = 1\n");
    const assembly = doc.components.find((c) => c.kind === "assembly")!;
    const part = doc.components.find((c) => c.kind === "part")!;
    doc = insertPartIntoAssembly(doc, assembly.id, part.id);
    const project = buildKclProject(doc, assembly.path);
    expect(project.entryPath).toBe(toZooKclPath(assembly.path));
    expect(project.files[toZooKclPath(part.path)]).toContain("width = 10");
    expect(project.files[project.entryPath]).toContain(`import "${toZooKclPath(part.path)}"`);
  });

  it("remaps parts/foo.kcl into parts/foo/main.kcl for Zoo", () => {
    expect(toZooKclPath("parts/enclosure-shell.kcl")).toBe("parts/enclosure-shell/main.kcl");
    expect(toZooKclPath("parts/main.kcl")).toBe("parts/main.kcl");
    expect(fromZooKclPath("parts/enclosure-shell/main.kcl")).toBe("parts/enclosure-shell.kcl");
  });
});

describe("foreign mesh import", () => {
  it("builds an UNVERIFIED KCL import stub", () => {
    const kcl = kclForForeignImport({
      path: "imports/bracket.stl",
      name: "bracket",
      format: "stl",
      lengthUnit: "mm",
    });
    expect(kcl).toContain("UNVERIFIED");
    expect(kcl).toContain('import "imports/bracket.stl" as bracket');
    expect(parseForeignImports(kcl)).toEqual([{ path: "imports/bracket.stl", alias: "bracket" }]);
    expect(isForeignImportOnlyScript(kcl)).toBe(true);
  });

  it("adds asset + part and round-trips through normalize", () => {
    const doc = importMeshAsPart(cadDoc(DEFAULT_KCL), {
      name: "housing",
      path: "imports/housing.stl",
      format: "stl",
      storageKey: "projects/p1/cad/imports/housing.stl",
      sizeBytes: 1200,
      lengthUnit: "mm",
    });
    expect(doc.assets).toHaveLength(1);
    expect(doc.assets![0]!.path).toBe("imports/housing.stl");
    const part = doc.components.find((c) => c.id === doc.activeId);
    expect(part?.content).toContain('import "imports/housing.stl"');

    const again = normalizeCadDoc(doc);
    expect(again.assets).toHaveLength(1);
    expect(again.assets![0]!.storageKey).toContain("housing.stl");
  });

  it("detects non-import scripts", () => {
    expect(isForeignImportOnlyScript(DEFAULT_KCL)).toBe(false);
  });
});

describe("removeCadComponents", () => {
  it("drops parts by id and reassigns activeId", () => {
    const base = upsertPartScript(cadDoc(DEFAULT_KCL), "lid", "width = 40\n");
    const lid = base.components.find((c) => c.name === "lid");
    expect(lid).toBeTruthy();
    const next = removeCadComponents(base, [lid!.id]);
    expect(next.components.some((c) => c.name === "lid")).toBe(false);
    expect(next.activeId).not.toBe(lid!.id);
    expect(next.components.some((c) => c.id === next.activeId)).toBe(true);
  });
});

describe("product assembly path", () => {
  it("forces every assembly create onto assembly/product.kcl", () => {
    const doc = addCadComponents(cadDoc(DEFAULT_KCL), [
      { name: "exploded", kind: "assembly", content: "a = 1\n" },
      { name: "layout", kind: "assembly", content: "b = 2\n" },
    ]);
    const assemblies = doc.components.filter((c) => c.kind === "assembly");
    expect(assemblies).toHaveLength(1);
    expect(assemblies[0]!.path).toBe(PRODUCT_ASSEMBLY_PATH);
    expect(assemblies[0]!.content).toContain("b = 2");
  });

  it("rewrites assembly writes via upsertCadContent to product.kcl", () => {
    const doc = upsertCadContent(cadDoc(DEFAULT_KCL), "assembly/custom.kcl", "c = 3\n");
    const assy = doc.components.find((c) => c.kind === "assembly");
    expect(assy?.path).toBe(PRODUCT_ASSEMBLY_PATH);
    expect(assy?.content).toContain("c = 3");
  });
});

describe("isPlausibleZooOpId", () => {
  it("rejects repeating placeholder uuids", () => {
    expect(isPlausibleZooOpId("44444444-4444-4444-8444-444444444444")).toBe(false);
    expect(isPlausibleZooOpId("33333333-3333-4333-8333-333333333333")).toBe(false);
    expect(isPlausibleZooOpId("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("accepts a normal uuid", () => {
    expect(isPlausibleZooOpId("fe555f9b-e6f7-4ed1-b18d-5c207206b91f")).toBe(true);
  });
});
