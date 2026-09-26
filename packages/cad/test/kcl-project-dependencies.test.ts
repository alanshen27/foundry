import { describe, expect, it } from "vitest";
import { buildKclProject, parseKclModuleImports, rewriteKclModuleImportPaths } from "../src/doc";
import type { CadDoc } from "../src/port";

function project(sources: Record<string, string>, assets: CadDoc["assets"] = []): CadDoc {
  return {
    version: 5,
    engine: "zoo",
    activeId: "assembly/product.kcl",
    script: sources["assembly/product.kcl"] ?? "",
    components: Object.entries(sources).map(([path, content]) => ({
      id: path,
      path,
      name: path,
      kind: path.startsWith("assembly/") ? "assembly" : "part",
      content,
    })),
    assets,
  };
}

describe("KCL project dependency closure", () => {
  it("includes only reachable files and deduplicates nested shared dependencies", () => {
    const doc = project({
      "assembly/product.kcl":
        'import "parts/left.kcl" as left\nimport "parts/right/main.kcl" as right\n',
      "parts/left.kcl": 'import "shared/shape.kcl" as shape\nleft = shape\n',
      "parts/right.kcl":
        'import buildShape as makeRight from "shared/shape/main.kcl" // shared source\n',
      "shared/shape.kcl": "export fn buildShape() { return 1 }\n",
      "parts/unrelated.kcl": 'import "imports/missing.stl" as unused\n',
      "assembly/unused.kcl": 'import "missing.kcl" as broken\n',
    });
    const built = buildKclProject(doc, "assembly/product.kcl");
    expect(Object.keys(built.files)).toEqual([
      "assembly/product/main.kcl",
      "parts/left/main.kcl",
      "parts/right/main.kcl",
      "shared/shape/main.kcl",
    ]);
    expect(built.files["parts/left/main.kcl"]).toContain('import "shared/shape/main.kcl"');
    expect(built.files["parts/right/main.kcl"]).toContain(
      'from "shared/shape/main.kcl" // shared source',
    );
    expect(built.meshAssets).toEqual([]);
  });

  it("preserves cyclic source for engine diagnostics without recursing forever", () => {
    const doc = project({
      "assembly/product.kcl": 'import "parts/a.kcl" as a\n',
      "parts/a.kcl": 'import "parts/b.kcl" as b\n',
      "parts/b.kcl": 'import "parts/a.kcl" as a\n',
      "parts/unused.kcl": "unused = 1\n",
    });
    const built = buildKclProject(doc, "assembly/product.kcl");
    expect(Object.keys(built.files)).toHaveLength(3);
    expect(built.files["parts/b/main.kcl"]).toContain('import "parts/a/main.kcl"');
  });

  it("reports a missing reachable module and preserves missing foreign-asset errors", () => {
    const doc = project({
      "assembly/product.kcl": 'export import body from "parts/missing.kcl"\n',
    });
    expect(() => buildKclProject(doc, "assembly/product.kcl")).toThrow(
      "Missing imported KCL module: parts/missing.kcl (in assembly/product.kcl)",
    );
    doc.components.push({
      id: "part",
      name: "Part",
      path: "parts/missing.kcl",
      kind: "part",
      content: 'import "imports/housing.step" as housing\n',
    });
    expect(() => buildKclProject(doc, "assembly/product.kcl")).toThrow(
      "Missing imported CAD asset: imports/housing.step (in parts/missing.kcl)",
    );
  });

  it("includes foreign geometry only once across reachable sources", () => {
    const doc = project(
      {
        "assembly/product.kcl": 'import "parts/a.kcl" as a\nimport "parts/b.kcl" as b\n',
        "parts/a.kcl": 'import "imports/shared.stl" as a\n',
        "parts/b.kcl": 'import "imports/shared.stl" as b\n',
        "parts/unrelated.kcl": 'import "imports/unrelated.stl" as unused\n',
      },
      [
        {
          id: "mesh",
          name: "Shared mesh",
          path: "imports/shared.stl",
          storageKey: "projects/local/shared.stl",
          format: "stl",
          sizeBytes: 42,
        },
      ],
    );
    expect(
      buildKclProject(doc, "assembly/product.kcl").meshAssets.map((asset) => asset.id),
    ).toEqual(["mesh"]);
  });
});

describe("KCL import parsing and rewriting", () => {
  it("handles named aliases, multiline imports, re-exports and trailing comments consistently", () => {
    const source = `import "parts/base.kcl" as base // keep the base
export import makeLid as lid, width from 'parts/lid.kcl' /* source */
import makeButton,
  buttonRadius from "parts/button.kcl"
export import "parts/spacer.kcl"
`;
    expect(parseKclModuleImports(source)).toEqual([
      { path: "parts/base.kcl", alias: "base" },
      { path: "parts/lid.kcl", alias: "lid" },
      { path: "parts/button.kcl", alias: "makeButton" },
      { path: "parts/spacer.kcl", alias: "spacer" },
    ]);
    const rewritten = rewriteKclModuleImportPaths(source);
    expect(rewritten).toBe(
      source.replaceAll(/parts\/(base|lid|button|spacer)\.kcl/g, "parts/$1/main.kcl"),
    );
    expect(parseKclModuleImports(rewritten).map((ref) => ref.path)).toEqual([
      "parts/base/main.kcl",
      "parts/lid/main.kcl",
      "parts/button/main.kcl",
      "parts/spacer/main.kcl",
    ]);
  });

  it("ignores commented imports and import-like strings while retaining foreign imports verbatim", () => {
    const source = `// import "parts/disabled.kcl" as disabled
/*
import "parts/commented.kcl" as commented
*/
note = "description\nimport 'parts/not-source.kcl' as text"
import /* chosen part */ "parts/real.kcl" as real // reference "parts/comment.kcl"
import "imports/mesh.stl" as mesh
`;
    expect(parseKclModuleImports(source)).toEqual([{ path: "parts/real.kcl", alias: "real" }]);
    expect(rewriteKclModuleImportPaths(source)).toBe(
      source.replace('"parts/real.kcl"', '"parts/real/main.kcl"'),
    );
  });
});
