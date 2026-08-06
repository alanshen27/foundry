import { describe, expect, it } from "vitest";
import {
  KCL_ENGINE_GUARDRAILS,
  buildFixIteratePrompt,
  buildRegeneratePrompt,
  withKclGuardrails,
} from "@/lib/cad/zoo-guardrails";

describe("withKclGuardrails", () => {
  it("appends the engine constraints to the design prompt", () => {
    const out = withKclGuardrails("A 60mm bracket");
    expect(out.startsWith("A 60mm bracket")).toBe(true);
    expect(out).toContain(KCL_ENGINE_GUARDRAILS);
    expect(out).toContain("cannot boolean union() or subtract()");
    expect(out).toContain("point(construction = true)");
  });
});

describe("buildRegeneratePrompt", () => {
  it("includes the design prompt, guardrails, and the engine error", () => {
    const out = buildRegeneratePrompt("A 60mm bracket", "engine exploded at line 3");
    expect(out).toContain("A 60mm bracket");
    expect(out).toContain(KCL_ENGINE_GUARDRAILS);
    expect(out).toContain("engine exploded at line 3");
    expect(out).toContain("Generate corrected KCL");
  });
});

describe("buildFixIteratePrompt", () => {
  it("asks for a fix that preserves the existing geometry", () => {
    const out = buildFixIteratePrompt(
      "A 60mm bracket",
      "The Zoo engine cannot handle this 3D union yet",
    );
    expect(out).toContain("The Zoo engine cannot handle this 3D union yet");
    expect(out).toContain("preserving the existing geometry");
    expect(out).toContain("A 60mm bracket");
    expect(out).toContain(KCL_ENGINE_GUARDRAILS);
  });
});
