import { describe, expect, it } from "vitest";
import { cadMeshRequestSchema } from "@/lib/cad/mesh-request";

const source = "from build123d import Box\nresult = Box(40, 30, 4)\n";
const input = {
  engine: "build123d",
  projectId: "p1",
  script: source,
  entryPath: "parts/base/main.py",
  projectFiles: { "parts/base/main.py": source },
};

describe("native Python preview request boundary", () => {
  it("accepts an explicit Python engine with its entry and dependency map", () => {
    expect(cadMeshRequestSchema.parse(input)).toEqual(input);
  });

  it("rejects missing entries and cross-language source maps", () => {
    for (const invalid of [
      { ...input, engine: undefined },
      { ...input, engine: "zoo" },
      { ...input, entryPath: undefined },
      { ...input, entryPath: "parts/missing/main.py" },
      { ...input, projectFiles: undefined },
      { ...input, projectFiles: { ...input.projectFiles, "legacy.kcl": "x = 1" } },
      {
        ...input,
        meshAssets: [
          { path: "secret.py", fileUrl: "/api/files/projects/p1/secret.py", format: "py" },
        ],
      },
    ])
      expect(cadMeshRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it.each([
    "../secret.py",
    "/tmp/secret.py",
    "parts/../secret.py",
    "parts/%2e%2e/secret.py",
    "parts/.private.py",
    "parts\\secret.py",
  ])("rejects unsafe Python source paths: %s", (path) => {
    expect(
      cadMeshRequestSchema.safeParse({
        ...input,
        entryPath: path,
        projectFiles: { [path]: source },
      }).success,
    ).toBe(false);
  });

  it("does not apply KCL quoted-import parsing to Python strings", () => {
    const code = '# Conversion note: import "../old.kcl" as old\n' + source;
    expect(
      cadMeshRequestSchema.safeParse({
        ...input,
        script: code,
        projectFiles: { "parts/base/main.py": code },
      }).success,
    ).toBe(true);
  });
});
