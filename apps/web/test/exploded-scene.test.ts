import { describe, expect, it } from "vitest";
import { cadDoc, upsertPartScript } from "@/lib/cad/engine";
import {
  buildExplodedScene,
  EXPLODED_SCENE_PATH,
  EXPLODED_SPACING_MM,
} from "@/lib/cad/exploded-scene";

const PART = `w = 10
s = startSketchOn(XY)
p = startProfile(s, at = [0, 0])
  |> line(end = [w, 0])
  |> line(end = [0, w])
  |> line(end = [-w, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
body = extrude(p, length = 4)
`;

describe("buildExplodedScene", () => {
  it("returns null with no parts", () => {
    expect(buildExplodedScene(null)).toBeNull();
  });

  it("imports every part before placing any instance", () => {
    let doc = upsertPartScript(cadDoc(""), "housing", PART);
    doc = upsertPartScript(doc, "knob", PART);
    const out = buildExplodedScene(doc)!;
    expect(out.entryPath).toBe(EXPLODED_SCENE_PATH);
    expect(out.script).toContain('import "parts/housing/main.kcl"');
    expect(out.script).toContain('import "parts/knob/main.kcl"');
    const lastImport = out.script.lastIndexOf('import "');
    const firstPlace = out.script.search(/^ex\d+_/m);
    expect(firstPlace).toBeGreaterThan(lastImport);
    expect(out.script).toContain(`translate(x = ${EXPLODED_SPACING_MM})`);
    expect(out.parts.map((p) => p.name)).toEqual(expect.arrayContaining(["housing", "knob"]));
  });

  it("lifts the focused part on Z for hover", () => {
    let doc = upsertPartScript(cadDoc(""), "housing", PART);
    doc = upsertPartScript(doc, "knob", PART);
    const knob = doc.components.find((c) => c.name === "knob")!;
    const out = buildExplodedScene(doc, { focusPartId: knob.id })!;
    expect(out.script).toMatch(/ex\d+_knob \|> translate\(x = \d+, z = \d+\)/);
  });
});
