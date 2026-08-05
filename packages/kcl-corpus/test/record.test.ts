import { describe, expect, it } from "vitest";
import { DEFAULT_KCL, cadDoc, meshPartProxyKcl } from "@foundry/cad";
import {
  buildSnippet,
  dedupeBySha,
  isBoilerplate,
  isTrivial,
  pseudonymize,
  sha256,
} from "../src/record";
import { extractDesignDoc } from "../src/extractors/design-doc";
import { extractRepoConstants } from "../src/extractors/repo";
import { extractSamples } from "../src/extractors/samples";

const PART_KCL = `width = 40
depth = 20
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [width, 0])
  |> close()
body = extrude(profile001, length = depth)
`;

describe("sha256 / pseudonymize", () => {
  it("hashes content stably and distinguishes different content", () => {
    expect(sha256("a")).toBe(sha256("a"));
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("pseudonymizes ids stably but differently per salt", () => {
    expect(pseudonymize("proj_1", "s1")).toBe(pseudonymize("proj_1", "s1"));
    expect(pseudonymize("proj_1", "s1")).not.toBe(pseudonymize("proj_1", "s2"));
    expect(pseudonymize("proj_1", "s1")).not.toContain("proj_1");
  });
});

describe("isBoilerplate", () => {
  it("flags the stock starter script", () => {
    expect(isBoilerplate(DEFAULT_KCL)).toBe(true);
  });

  it("flags a mesh proxy regardless of part name", () => {
    expect(isBoilerplate(meshPartProxyKcl("bracket"))).toBe(true);
    expect(isBoilerplate(meshPartProxyKcl("totally-different"))).toBe(true);
  });

  it("does not flag authored geometry", () => {
    expect(isBoilerplate(PART_KCL)).toBe(false);
  });
});

describe("isTrivial", () => {
  it("rejects empty and comment-only scripts", () => {
    expect(isTrivial("", "part")).toBe(true);
    expect(isTrivial("// just a note\n// and another\n", "part")).toBe(true);
  });

  it("keeps real geometry", () => {
    expect(isTrivial(PART_KCL, "part")).toBe(false);
  });

  it("holds instructions to a prose-length bar", () => {
    expect(isTrivial("# Hi", "instructions")).toBe(true);
    expect(isTrivial("# Assembly\n\n1. Print each part.\n", "instructions")).toBe(false);
  });
});

describe("buildSnippet", () => {
  it("captures shape, params and import flags", () => {
    const snippet = buildSnippet({
      content: PART_KCL,
      componentKind: "part",
      origin: "human",
      license: "user-content",
    });
    expect(snippet.sha256).toHaveLength(64);
    expect(snippet.charLen).toBe(PART_KCL.length);
    expect(snippet.topLevelParams).toEqual([
      { name: "width", value: 40 },
      { name: "depth", value: 20 },
    ]);
    expect(snippet.hasModuleImports).toBe(false);
    expect(snippet.isBoilerplate).toBe(false);
  });

  it("detects module imports so they are never treated as standalone-verifiable", () => {
    const snippet = buildSnippet({
      content: `import "parts/lid/main.kcl" as lid\nlid\n`,
      componentKind: "assembly",
      origin: "human",
      license: "user-content",
    });
    expect(snippet.hasModuleImports).toBe(true);
  });

  it("does not parse KCL grammar out of markdown instructions", () => {
    const snippet = buildSnippet({
      content: "# Assembly\n\nwidth = 60 is just prose here.\n",
      componentKind: "instructions",
      origin: "human",
      license: "user-content",
    });
    expect(snippet.topLevelParams).toEqual([]);
    expect(snippet.hasModuleImports).toBe(false);
  });
});

describe("dedupeBySha", () => {
  it("collapses identical content", () => {
    const make = () => ({
      snippet: buildSnippet({
        content: PART_KCL,
        componentKind: "part" as const,
        origin: "human" as const,
        license: "user-content",
      }),
    });
    expect(dedupeBySha([make(), make(), make()])).toHaveLength(1);
  });
});

describe("extractDesignDoc", () => {
  const opts = { salt: "test-salt" };

  it("extracts authored components and pseudonymizes ids", () => {
    const doc = cadDoc(PART_KCL);
    const records = extractDesignDoc(
      { id: "dd_1", projectId: "proj_1", branchId: "br_1", data: doc, updatedAt: new Date(0) },
      opts,
    );
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record!.snippet.content).toBe(PART_KCL);
    expect(record!.occurrence.sourceKind).toBe("design_doc");
    expect(record!.occurrence.projectRef).not.toBe("proj_1");
    expect(record!.occurrence.branchRef).not.toBe("br_1");
    expect(record!.occurrence.observedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("contributes nothing from an untouched workspace", () => {
    const row = {
      id: "dd_2",
      projectId: "p",
      branchId: "b",
      data: cadDoc(DEFAULT_KCL),
      updatedAt: new Date(0),
    };
    // A fresh doc is seeded with three stock components (part, assembly,
    // instructions). All are boilerplate, so the corpus takes none of them.
    expect(extractDesignDoc(row, opts)).toHaveLength(0);

    const kept = extractDesignDoc(row, { ...opts, includeBoilerplate: true });
    expect(kept).toHaveLength(3);
    expect(kept.every((r) => r.snippet.isBoilerplate)).toBe(true);
  });

  it("never counts the CadDoc.script compat mirror as a second sample", () => {
    const doc = cadDoc(PART_KCL);
    // cadDoc mirrors the active component into `script`; only components[] counts.
    expect(doc.script).toBe(PART_KCL);
    const records = extractDesignDoc(
      { id: "dd_3", projectId: "p", branchId: "b", data: doc, updatedAt: new Date(0) },
      opts,
    );
    expect(records).toHaveLength(1);
  });

  it("migrates a legacy v4 doc through normalizeCadDoc", () => {
    const records = extractDesignDoc(
      {
        id: "dd_4",
        projectId: "p",
        branchId: "b",
        data: { version: 4, engine: "zoo", script: PART_KCL },
        updatedAt: new Date(0),
      },
      opts,
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.snippet.content).toBe(PART_KCL);
  });
});

describe("extractRepoConstants", () => {
  it("records the shipped templates with the repo licence", () => {
    const records = extractRepoConstants({ license: "foundry-repo" });
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.snippet.origin === "template")).toBe(true);
    expect(records.every((r) => r.snippet.license === "foundry-repo")).toBe(true);
    expect(records.every((r) => r.occurrence.sourceKind === "repo")).toBe(true);
    // These are the very constants isBoilerplate flags.
    expect(records.some((r) => r.snippet.isBoilerplate)).toBe(true);
  });
});

describe("extractSamples", () => {
  const opts = { license: "MIT", sourceRepo: "KittyCAD/kcl-samples" };

  it("names a part after its directory and classifies importers as assemblies", () => {
    const records = extractSamples(
      [
        { path: "bracket/main.kcl", content: PART_KCL },
        { path: "main.kcl", content: `import "bracket/main.kcl" as bracket\nbracket\n` },
        { path: "README.md", content: "not kcl" },
      ],
      opts,
    );
    expect(records).toHaveLength(2);
    expect(records[0]!.occurrence.componentName).toBe("bracket");
    expect(records[0]!.snippet.componentKind).toBe("part");
    expect(records[1]!.snippet.componentKind).toBe("assembly");
    expect(records[0]!.occurrence.sourceId).toBe("KittyCAD/kcl-samples:bracket/main.kcl");
    expect(records.every((r) => r.snippet.origin === "external")).toBe(true);
  });
});
