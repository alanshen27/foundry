import { describe, expect, it } from "vitest";
import { closeFailureMessage, extractKclOutputs, reasoningText } from "../src/zookeeper";

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

describe("reasoningText", () => {
  it("collapses whitespace in markdown reasoning", () => {
    expect(reasoningText({ reasoning: { type: "markdown", content: "I'll\n  build it." } })).toBe(
      "I'll build it.",
    );
  });

  it("ignores non-reasoning and blank frames", () => {
    expect(reasoningText({ delta: { delta: "x" } })).toBeNull();
    expect(reasoningText({ reasoning: { content: "  " } })).toBeNull();
  });
});

describe("closeFailureMessage", () => {
  it("reports the close code and the model's last narration", () => {
    expect(
      closeFailureMessage({
        code: 1006,
        reason: "",
        hadFiles: false,
        narration: "I cannot model helical threads.",
      }),
    ).toBe(
      'Zoo Zookeeper closed without outputs (close 1006) — last from the model: "I cannot model helical threads."',
    );
  });

  it("distinguishes a drop after files arrived, and keeps the close reason", () => {
    expect(
      closeFailureMessage({
        code: 1011,
        reason: "internal error",
        hadFiles: true,
        narration: null,
      }),
    ).toBe("Zoo Zookeeper closed before end_of_stream (close 1011: internal error)");
  });

  it("truncates long narration", () => {
    const message = closeFailureMessage({
      code: 1000,
      reason: "",
      hadFiles: false,
      narration: "x".repeat(500),
    });
    expect(message).toContain("…");
    expect(message.length).toBeLessThan(360);
  });
});
