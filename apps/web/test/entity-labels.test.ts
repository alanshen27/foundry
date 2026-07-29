import { describe, expect, it, vi } from "vitest";
import {
  entityIdFromHighlight,
  pairSolidNames,
  prettyEntityType,
  resolveHoverLabel,
  solidIdsFromSceneGet,
} from "@/lib/cad/entity-labels";

function okModeling(type: string, data: unknown) {
  return {
    success: true,
    resp: {
      type: "modeling",
      data: { modeling_response: { type, data } },
    },
  };
}

describe("entity label parsing", () => {
  it("reads entity_id from highlight responses", () => {
    expect(entityIdFromHighlight(okModeling("highlight_set_entity", { entity_id: "abc" }))).toBe(
      "abc",
    );
    expect(entityIdFromHighlight(okModeling("highlight_set_entity", {}))).toBeNull();
  });

  it("flattens scene_get_entity_ids groups", () => {
    expect(
      solidIdsFromSceneGet(okModeling("scene_get_entity_ids", { entity_ids: [["a", "b"], ["c"]] })),
    ).toEqual(["a", "b", "c"]);
  });

  it("pairs KCL solid names with engine ids in order", () => {
    const script = `
shell = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> close()
  |> extrude(length = 5)
lid = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [8, 0])
  |> close()
  |> extrude(length = 2)
`;
    const map = pairSolidNames(script, ["id-shell", "id-lid", "id-extra"]);
    expect(map.get("id-shell")).toBe("shell");
    expect(map.get("id-lid")).toBe("lid");
    expect(map.has("id-extra")).toBe(false);
  });

  it("pretty-prints entity types", () => {
    expect(prettyEntityType("solid3d")).toBe("Solid");
    expect(prettyEntityType("face")).toBe("Face");
    expect(prettyEntityType("mystery")).toBe("Part");
  });
});

describe("resolveHoverLabel", () => {
  it("returns a named solid for a direct hit", async () => {
    const names = new Map([["solid-1", "shell"]]);
    const send = vi.fn();
    const cache = new Map<string, string | null>();
    await expect(resolveHoverLabel("solid-1", names, send, cache)).resolves.toBe("shell");
    expect(send).not.toHaveBeenCalled();
  });

  it("walks parents from a face to a named solid", async () => {
    const names = new Map([["solid-1", "lid"]]);
    const send = vi.fn(async (cmd: { type: string; entity_id?: string }) => {
      if (cmd.type === "get_entity_type" && cmd.entity_id === "face-1") {
        return okModeling("get_entity_type", { entity_type: "face" });
      }
      if (cmd.type === "entity_get_parent_id" && cmd.entity_id === "face-1") {
        return okModeling("entity_get_parent_id", { entity_id: "solid-1" });
      }
      throw new Error(`unexpected ${cmd.type}`);
    });
    const cache = new Map<string, string | null>();
    await expect(resolveHoverLabel("face-1", names, send, cache)).resolves.toBe("lid");
    expect(cache.get("face-1")).toBe("lid");
  });
});
