import { describe, expect, it } from "vitest";
import { extractKclOutputs } from "../src/zookeeper";

describe("extractKclOutputs", () => {
  it("reads MlToolResult.outputs", () => {
    const out = extractKclOutputs({
      tool_output: {
        result: {
          type: "edit_kcl_code",
          status_code: 200,
          outputs: { "main.kcl": "width = 1\n", "parts/a/main.kcl": "a = 1\n" },
        },
      },
    });
    expect(out).toEqual({
      "main.kcl": "width = 1\n",
      "parts/a/main.kcl": "a = 1\n",
    });
  });

  it("reads project_updated.files", () => {
    const out = extractKclOutputs({
      project_updated: { files: { "assembly/product/main.kcl": "import x\n" } },
    });
    expect(out).toEqual({ "assembly/product/main.kcl": "import x\n" });
  });

  it("ignores empty maps", () => {
    expect(extractKclOutputs({ outputs: {} })).toBeNull();
    expect(extractKclOutputs(null)).toBeNull();
  });
});
