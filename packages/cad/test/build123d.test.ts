import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { runBuild123d, summarizePythonError } from "../src/build123d";

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

// Real OCCT execution — needs uv on PATH (first run may download wheels).
describe.skipIf(!hasUv)("runBuild123d (live, uv)", () => {
  it("builds a box and reports its bounding box", { timeout: 300_000 }, async () => {
    const result = await runBuild123d("from build123d import *\nresult = Box(10, 20, 5)\n");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.stl.byteLength).toBeGreaterThan(0);
      expect(result.data.bbox).toEqual({ x: 10, y: 20, z: 5 });
    }
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
