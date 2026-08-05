import { describe, expect, it } from "vitest";
import { parseCadParams, setCadParam } from "@/lib/cad/params";

const SCRIPT = `// demo
width = 60
depth = 30.5
hollow = true
label = "rev-a"

sketch001 = startSketchOn(XY)
`;

describe("parseCadParams", () => {
  it("extracts numbers, booleans and strings from top-level KCL bindings", () => {
    const params = parseCadParams(SCRIPT);
    expect(params.map((p) => [p.name, p.value])).toEqual([
      ["width", 60],
      ["depth", 30.5],
      ["hollow", true],
      ["label", "rev-a"],
    ]);
  });

  it("returns [] when there are no leading assignments", () => {
    expect(parseCadParams("sketch001 = startSketchOn(XY)\n")).toEqual([]);
  });

  it("stops at the first non-assignment modeling line", () => {
    const script = `a = 1\nsketch001 = startSketchOn(XY)\nb = 2\n`;
    expect(parseCadParams(script).map((p) => p.name)).toEqual(["a"]);
  });

  it("locates the value when the name ends in the same digits", () => {
    const params = parseCadParams("d1 = 1\nhole12 = 12\n");
    expect(params.map((p) => [p.name, p.value])).toEqual([
      ["d1", 1],
      ["hole12", 12],
    ]);
    // Offsets must point at the literal after `=`, not at a digit in the name.
    expect(params.map((p) => [p.start, p.end])).toEqual([
      [5, 6],
      [16, 18],
    ]);
  });
});

describe("setCadParam", () => {
  it("rewrites a numeric value in place", () => {
    const next = setCadParam(SCRIPT, "width", 75);
    expect(next).toContain("width = 75");
    expect(parseCadParams(next).find((p) => p.name === "width")?.value).toBe(75);
    expect(next).toContain('label = "rev-a"');
    expect(next).toContain("startSketchOn(XY)");
  });

  it("rewrites booleans and strings", () => {
    let next = setCadParam(SCRIPT, "hollow", false);
    next = setCadParam(next, "label", "rev-b");
    const params = parseCadParams(next);
    expect(params.find((p) => p.name === "hollow")?.value).toBe(false);
    expect(params.find((p) => p.name === "label")?.value).toBe("rev-b");
  });

  it("is a no-op for unknown names", () => {
    expect(setCadParam(SCRIPT, "missing", 1)).toBe(SCRIPT);
  });

  it("round-trips repeated edits", () => {
    let script = SCRIPT;
    for (const value of [10, 200, 3.5]) {
      script = setCadParam(script, "depth", value);
      expect(parseCadParams(script).find((p) => p.name === "depth")?.value).toBe(value);
    }
  });
});
