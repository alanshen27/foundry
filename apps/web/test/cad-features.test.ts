import { describe, expect, it } from "vitest";
import { parseCadFeatureFields, parseCadFeatures, setCadFeatureField } from "@/lib/cad/features";

const SCRIPT = `// generated part
width = 60
height = 20

sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-width / 2, 0])
  |> line(end = [width, 0])
  |> close()
body001 = extrude(profile001, length = height)
  |> fillet(radius = 2, tags = [END])
body002 = body001
  |> translate(x = width, y = 0, z = 0)
`;

describe("parseCadFeatures", () => {
  it("derives ordered editable features and their parameter dependencies", () => {
    const features = parseCadFeatures(SCRIPT);
    expect(features.map((feature) => feature.binding)).toEqual([
      "sketch001",
      "profile001",
      "body001",
      "body002",
    ]);
    expect(features[2]).toMatchObject({
      kind: "modify",
      operation: "fillet",
      isSolid: true,
      parameterNames: ["height"],
    });
    expect(features[3]).toMatchObject({
      kind: "transform",
      operation: "translate",
      isSolid: true,
      parameterNames: ["width"],
    });
  });

  it("includes foreign imports as reference-body features", () => {
    const [feature] = parseCadFeatures('import "imports/bracket.step" as bracket\nbracket\n');
    expect(feature).toMatchObject({
      binding: "bracket",
      kind: "import",
      operation: "import",
      isSolid: true,
    });
  });

  it("edits inline feature arguments without rewriting the surrounding KCL", () => {
    const script = "body = extrude(profile, length = 20)\n";
    const [feature] = parseCadFeatures(script);
    const [field] = parseCadFeatureFields(feature!);
    expect(field).toMatchObject({ name: "length", value: 20 });
    expect(setCadFeatureField(script, feature!, field!, 35)).toBe(
      "body = extrude(profile, length = 35)\n",
    );
  });
});
