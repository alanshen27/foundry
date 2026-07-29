import { describe, expect, it } from "vitest";
import {
  applyCadTool,
  findLastSketch,
  findLastSolid,
  nextBinding,
  pipeOntoSolid,
  pushPullFace,
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

  it("applies modifying tools to an explicitly selected solid", () => {
    const withTwo = `${BASE}
other = startSketchOn(XY)
  |> circle(center = [80, 0], radius = 10)
  |> extrude(length = 10)
`;
    const { script, target } = applyCadTool(
      withTwo,
      "rotate",
      { yaw: 30, pitch: 0, roll: 0 },
      { targetSolid: "body" },
    );
    expect(target).toBe("body");
    expect(script.indexOf("|> rotate")).toBeLessThan(script.indexOf("other ="));
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

  it("creates additional parametric primitive families", () => {
    expect(applyCadTool("// empty\n", "sphere", { radius: 18 }).script).toContain("revolve(");
    expect(
      applyCadTool("// empty\n", "cone", {
        baseRadius: 20,
        topRadius: 4,
        height: 30,
      }).script,
    ).toContain("loft([");
    expect(
      applyCadTool("// empty\n", "tube", {
        outerRadius: 20,
        wall: 3,
        height: 40,
      }).script,
    ).toContain("subtract(");
  });

  it("adds sweep, appearance, and duplicate operations", () => {
    expect(
      applyCadTool("// empty\n", "sweep", {
        radius: 3,
        length: 40,
        bend: 12,
        rise: 18,
      }).script,
    ).toContain("sweep(");
    expect(
      applyCadTool(BASE, "appearance", {
        color: "#3366ff",
        metalness: 30,
        roughness: 40,
        opacity: 100,
      }).script,
    ).toContain('|> appearance(color = "#3366ff"');
    expect(applyCadTool(BASE, "duplicate", { x: 30, y: 0, z: 0 }).script).toContain("clone(body)");
  });

  it("creates Fusion-style sketch, construction, and fastener features", () => {
    const slot = applyCadTool("// empty\n", "slotSketch", {
      plane: "XY",
      length: 36,
      width: 12,
    }).script;
    expect(slot).toContain("tangentialArc");
    expect(slot).toContain("|> close()");

    const plane = applyCadTool("// empty\n", "offsetPlane", {
      plane: "XZ",
      offset: 25,
    }).script;
    expect(plane).toContain("offsetPlane(XZ, offset =");
    expect(plane).toContain("startSketchOn(constructionPlane");

    const nut = applyCadTool("// empty\n", "hexNut", {
      outerRadius: 10,
      boreRadius: 4,
      height: 6,
    }).script;
    expect(nut).toContain("numSides = 6");
    expect(nut).toContain("subtract(");
  });
});

describe("pushPullFace", () => {
  it("edits the driving dimension for a principal face", () => {
    const result = pushPullFace(BASE, "top", 7.5);
    expect(result.parameter).toBe("height");
    expect(result.value).toBe(27.5);
    expect(result.script).toContain("height = 27.5");
  });
});
