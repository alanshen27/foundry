import { describe, expect, it } from "vitest";
import {
  closeFailureMessage,
  errorDetail,
  extractKclOutputs,
  reasoningText,
  toolResultText,
} from "../src/zookeeper";

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

  it("summarizes the typed variants that carry no content", () => {
    expect(
      reasoningText({
        reasoning: {
          type: "design_plan",
          steps: [
            { filepath_to_edit: "main.kcl", edit_instructions: "Extrude the base plate" },
            { filepath_to_edit: "lid.kcl", edit_instructions: "Add the lid" },
          ],
        },
      }),
    ).toBe("Plan (2 steps) · main.kcl: Extrude the base plate");
    expect(reasoningText({ reasoning: { type: "generated_kcl_code", code: "a\nb\nc" } })).toBe(
      "Generated 3 lines of KCL",
    );
    expect(
      reasoningText({ reasoning: { type: "kcl_code_error", error: "unknown fn `sweep`" } }),
    ).toBe("KCL error — unknown fn `sweep`");
    expect(
      reasoningText({
        reasoning: { type: "updated_kcl_file", file_name: "main.kcl", content: "…" },
      }),
    ).toBe("Updated main.kcl");
  });

  it("labels reference dumps instead of echoing pages of docs", () => {
    expect(reasoningText({ reasoning: { type: "kcl_docs", content: "x".repeat(20_000) } })).toBe(
      "Consulting KCL documentation",
    );
  });
});

describe("toolResultText", () => {
  it("reports the tool verdict and surfaces its error", () => {
    expect(
      toolResultText({ tool_output: { result: { type: "text_to_cad", status_code: 200 } } }),
    ).toBe("text_to_cad finished");
    expect(
      toolResultText({
        tool_output: { result: { type: "edit_kcl_code", status_code: 400, error: "bad range" } },
      }),
    ).toBe("edit_kcl_code failed: bad range");
  });

  it("ignores frames that aren't tool output", () => {
    expect(toolResultText({ reasoning: { type: "text", content: "hi" } })).toBeNull();
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

describe("errorDetail", () => {
  it("uses a string error", () => {
    expect(errorDetail({ error: "prompt blocked" })).toBe(
      "The CAD generation service rejected the request: prompt blocked",
    );
  });

  it("extracts detail from an error object", () => {
    expect(errorDetail({ error: { detail: "Unsupported geometry" } })).toBe(
      "The CAD generation service rejected the request: Unsupported geometry",
    );
  });

  it("prefers detail but falls back to message", () => {
    expect(errorDetail({ error: { message: "Quota exceeded", error_code: "quota" } })).toBe(
      "The CAD generation service rejected the request: Quota exceeded (code=quota)",
    );
  });

  it("includes request_id when present", () => {
    expect(
      errorDetail({
        error: { detail: "Bad request", error_code: "bad_request", request_id: "r1" },
      }),
    ).toBe(
      "The CAD generation service rejected the request: Bad request (code=bad_request, request_id=r1)",
    );
  });

  it("falls back to a bounded JSON dump for unknown shapes", () => {
    const msg = errorDetail({ error: { foo: "bar".repeat(200) } });
    expect(msg).toContain("The CAD generation service rejected the request:");
    expect(msg).toContain("foo");
    expect(msg).toContain("…");
    expect(msg.length).toBeLessThan(320);
  });

  it("returns the generic message for a missing error", () => {
    expect(errorDetail({ unexpected: true })).toBe(
      "The CAD generation service rejected the request.",
    );
  });
});
