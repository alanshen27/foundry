import { describe, expect, it, vi, beforeEach } from "vitest";

const generateObject = vi.fn();
const getServerEnv = vi.fn();

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObject(...args),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (model: string) => model,
}));

vi.mock("@foundry/config", () => ({
  getServerEnv: () => getServerEnv(),
}));

const {
  shouldInvokeAi,
  shouldSuggestAiPing,
  buildAiPingTip,
  lastUserText,
} = await import("@/server/chat-run/should-respond");

beforeEach(() => {
  generateObject.mockReset();
  getServerEnv.mockReturnValue({
    OPENAI_API_KEY: "sk-test",
    AI_LIGHT_MODEL: "gpt-4.1-nano",
  });
});

describe("shouldInvokeAi", () => {
  it("only runs when @AI is present", () => {
    expect(shouldInvokeAi("@AI design a box")).toBe(true);
    expect(shouldInvokeAi("can you update the BOM?")).toBe(false);
    expect(shouldInvokeAi("noted")).toBe(false);
  });
});

describe("shouldSuggestAiPing", () => {
  it("never suggests when @AI is already present", async () => {
    await expect(shouldSuggestAiPing("@AI design a box")).resolves.toBe(false);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("uses the light model triage result", async () => {
    generateObject.mockResolvedValueOnce({ object: { suggestPing: true } });
    await expect(shouldSuggestAiPing("can you update the BOM?")).resolves.toBe(true);
    generateObject.mockResolvedValueOnce({ object: { suggestPing: false } });
    await expect(shouldSuggestAiPing("noted, shipping tomorrow")).resolves.toBe(false);
  });

  it("falls back to heuristics when the light model fails", async () => {
    generateObject.mockRejectedValueOnce(new Error("boom"));
    await expect(shouldSuggestAiPing("what thickness should the wall be?")).resolves.toBe(true);
    generateObject.mockRejectedValueOnce(new Error("boom"));
    await expect(shouldSuggestAiPing("thanks")).resolves.toBe(false);
  });
});

describe("buildAiPingTip", () => {
  it("builds a stable tip id that mentions @AI", () => {
    const tip = buildAiPingTip("msg-1");
    expect(tip.id).toBe("ai-ping-tip-msg-1");
    expect(tip.role).toBe("assistant");
    const text = tip.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("");
    expect(text).toMatch(/@AI/);
  });
});

describe("lastUserText", () => {
  it("returns the latest user text parts", () => {
    expect(
      lastUserText([
        { id: "1", role: "assistant", parts: [{ type: "text", text: "hi" }] },
        { id: "2", role: "user", parts: [{ type: "text", text: "do the thing" }] },
      ]),
    ).toBe("do the thing");
  });
});
