import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { runBuild123d, summarizePythonError, extractProgressNote } from "../src/build123d";

describe("summarizePythonError", () => {
  it("prefers the explicit driver contract error", () => {
    const logs = `Traceback (most recent call last):\n  ...\nBUILD123D_ERROR: the script must assign the finished model to a variable named 'result'\nextra`;
    expect(summarizePythonError(logs)).toBe(
      "the script must assign the finished model to a variable named 'result'",
    );
  });

  it("extracts the exception line and offending source from a traceback", () => {
    const logs = [
      "some pip noise",
      "Traceback (most recent call last):",
      '  File "model.py", line 3, in <module>',
      "    result = Box(10, 'a', 5)",
      "TypeError: unsupported operand",
    ].join("\n");
    const out = summarizePythonError(logs);
    expect(out).toContain("TypeError: unsupported operand");
    expect(out).toContain("result = Box(10, 'a', 5)");
  });

  it("falls back to the log tail when there is no traceback", () => {
    expect(summarizePythonError("boom")).toBe("boom");
    expect(summarizePythonError("")).toBe("build123d run failed with no output");
  });
});

const hasUv = (() => {
  try {
    execSync("uv --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("extractProgressNote", () => {
  it("returns the note after the progress prefix", () => {
    expect(extractProgressNote("BUILD123D_PROGRESS: sketching base")).toBe("sketching base");
  });

  it("returns null for unrelated output", () => {
    expect(extractProgressNote("some pip noise")).toBeNull();
    expect(extractProgressNote("")).toBeNull();
  });

  it("extracts the marker from output with leading text", () => {
    expect(extractProgressNote("[stderr] BUILD123D_PROGRESS: exporting mesh")).toBe(
      "exporting mesh",
    );
  });
});

// Real OCCT execution — needs uv on PATH (first run may download wheels).
describe.skipIf(!hasUv)("runBuild123d (live, uv)", () => {
  it(
    "builds a box, reports its bounding box, and streams progress",
    { timeout: 300_000 },
    async () => {
      const notes: string[] = [];
      const result = await runBuild123d("from build123d import *\nresult = Box(10, 20, 5)\n", {
        onProgress: (note) => notes.push(note),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stl.byteLength).toBeGreaterThan(0);
        expect(result.data.bbox).toEqual({ x: 10, y: 20, z: 5 });
      }
      expect(notes).toContain("computing bounding box");
      expect(notes).toContain("exporting mesh");
    },
  );

  it("streams user-defined progress markers", { timeout: 300_000 }, async () => {
    const notes: string[] = [];
    const result = await runBuild123d(
      "from build123d import *\nprint('BUILD123D_PROGRESS: sketching base')\nresult = Box(10, 20, 5)\n",
      { onProgress: (note) => notes.push(note) },
    );
    expect(result.ok).toBe(true);
    expect(notes).toContain("sketching base");
  });

  it("returns the actionable Python error on a broken script", { timeout: 300_000 }, async () => {
    const result = await runBuild123d("from build123d import *\nresult = Box(10, 'oops')\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("rejects a script that never sets result", { timeout: 300_000 }, async () => {
    const result = await runBuild123d("from build123d import *\nx = Box(1, 1, 1)\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("result");
  });
});
