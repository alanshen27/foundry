import { describe, expect, it } from "vitest";
import { seedAssemblyKcl } from "../src/assembly-layout";
import { wholeFileSourceRange } from "../src/zoo";

describe("wholeFileSourceRange", () => {
  it("does not invent a phantom line for a trailing newline", () => {
    // Same shape as seedAssemblyKcl for one part: ends with "\n".
    const seed = [
      "// Product assembly",
      "",
      'import "parts/shell/main.kcl" as shell',
      "",
      "shell",
      "",
    ].join("\n");

    const range = wholeFileSourceRange(seed);
    expect(range.start).toEqual({ line: 0, column: 0 });
    // Last real line is "shell" at index 4 — NOT empty line 5 from trailing \n.
    expect(range.end).toEqual({ line: 4, column: "shell".length });
  });

  it("clamps the six-part+PCB seed below the old phantom end.line=24", () => {
    const seed = seedAssemblyKcl(
      ["shell", "lens", "chassis", "reservoir", "cover", "chimney", "pcb"].map((name) => ({
        name,
        path: `parts/${name}.kcl`,
      })),
    );

    // Old bug: split("\n").length - 1 overshoots into the trailing newline.
    const oldEnd = seed.split("\n").length - 1;
    expect(oldEnd).toBeGreaterThanOrEqual(24);

    const range = wholeFileSourceRange(seed);
    expect(range.end.line).toBeLessThan(oldEnd);
    expect(range.end.column).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    expect(wholeFileSourceRange("")).toEqual({
      start: { line: 0, column: 0 },
      end: { line: 0, column: 0 },
    });
  });
});
