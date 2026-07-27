import { describe, expect, it } from "vitest";
import {
  applyCadTool,
  findLastSketch,
  findLastSolid,
  nextBinding,
  pipeOntoSolid,
  upsertParams,
} from "@/lib/cad/tools";

const BASE = `// Zoo KCL
width = 60
depth = 30
height = 20

sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-width / 2, -depth / 2])
  |> line(end = [width, 0])
  |> line(end = [0, depth])
  |> line(end = [-width, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
body = extrude(profile001, length = height)
`;

describe("nextBinding", () => {
  it("increments past existing numbered names", () => {
    expect(nextBinding("body001 = 1\nbody003 = 2\n", "body")).toBe("body004");
    expect(nextBinding("sketch001 = startSketchOn(XY)\n", "sketch")).toBe("sketch002");
  });
});

describe("findLastSolid / findLastSketch", () => {
  it("finds the extruded body and open sketch profile", () => {
    expect(findLastSolid(BASE)).toBe("body");
    expect(findLastSketch(BASE)).toBe("profile001");
  });
});

describe("upsertParams", () => {
  it("inserts new params after existing ones", () => {
    const next = upsertParams(BASE, { yaw001: 45 });
    expect(next).toMatch(/height = 20\nyaw001 = 45\n/);
  });

  it("updates an existing param in place", () => {
    const next = upsertParams(BASE, { width: 80 });
    expect(next).toContain("width = 80");
    expect(next).not.toMatch(/width = 60/);
  });
});

describe("pipeOntoSolid", () => {
  it("appends pipe ops onto the solid assignment", () => {
    const next = pipeOntoSolid(BASE, "body", "|> rotate(yaw = 45deg)");
    expect(next).toContain("body = extrude(profile001, length = height)");
    expect(next).toContain("|> rotate(yaw = 45deg)");
    expect(next.indexOf("|> rotate")).toBeGreaterThan(next.indexOf("extrude(profile001"));
  });
});

describe("applyCadTool", () => {
  it("creates a box with params and extrude", () => {
    const { script, target } = applyCadTool("// empty\n", "box", {
      plane: "XY",
      width: 40,
      depth: 40,
      height: 40,
    });
    expect(target).toMatch(/^body/);
    expect(script).toContain("startSketchOn(XY)");
    expect(script).toContain("extrude(");
    expect(script).toMatch(/width\d* = 40/);
  });

  it("rotates the last solid via pipeline", () => {
    const { script, target } = applyCadTool(BASE, "rotate", {
      yaw: 90,
      pitch: 0,
      roll: 0,
    });
    expect(target).toBe("body");
    expect(script).toContain("|> rotate(yaw =");
    expect(script).toMatch(/yaw\d* = 90/);
  });

  it("mirrors across a plane into a new binding", () => {
    const { script, target } = applyCadTool(BASE, "mirror", { plane: "YZ" });
    expect(target).toMatch(/^body/);
    expect(script).toContain("mirror3d([body], across = YZ)");
  });

  it("starts a sketch on a plane", () => {
    const { script } = applyCadTool(BASE, "plane", { plane: "XZ" });
    expect(script).toContain("startSketchOn(XZ)");
  });

  it("throws when modify tools lack a solid", () => {
    expect(() => applyCadTool("width = 1\n", "fillet", { radius: 2 })).toThrow(/solid/i);
  });

  it("unions the two most recent solids", () => {
    const withTwo = `${BASE}
other = startSketchOn(XY)
  |> circle(center = [80, 0], radius = 10)
  |> extrude(length = 10)
`;
    const { script } = applyCadTool(withTwo, "union", {});
    expect(script).toMatch(/body\d+ = union\(\[body, other\]\)/);
  });
});
