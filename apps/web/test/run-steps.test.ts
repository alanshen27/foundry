import { describe, expect, it } from "vitest";
import { MAX_RUN_STEPS, finalStepSettings } from "@/server/chat-run/prompt";

describe("run step budget", () => {
  it("leaves tools on until the last step, then makes the model answer", () => {
    expect(finalStepSettings(0)).toBeUndefined();
    expect(finalStepSettings(MAX_RUN_STEPS - 2)).toBeUndefined();
    const last = finalStepSettings(MAX_RUN_STEPS - 1);
    expect(last?.toolChoice).toBe("none");
    expect(last?.instructions).toContain("last step of this run");
  });
});
