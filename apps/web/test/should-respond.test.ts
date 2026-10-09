import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { UIMessage } from "ai";

const getServerEnv = vi.fn();
const fetchMock = vi.fn();

vi.mock("@foundry/config", () => ({
  getServerEnv: () => getServerEnv(),
}));

const { shouldInvokeAi, shouldSuggestAiPing, buildAiPingTip, lastUserText, cleanedChatHistory } =
  await import("@/server/chat-run/should-respond");

function turn(role: "user" | "assistant", text: string, id = text): UIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

function jevResponse(noul: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ answers: { needs_ai: { type: "noul", noul } } }),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  getServerEnv.mockReturnValue({
    OPENROUTER_API_KEY: "sk-or-test",
    JEV_MODEL: "typesafe/jev-1.13",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    await expect(shouldSuggestAiPing([turn("user", "@AI design a box")])).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks Jev over the cleaned history and treats noul >= 0.5 as yes", async () => {
    fetchMock.mockResolvedValueOnce(jevResponse(0.91));
    const messages: UIMessage[] = [
      turn("user", "the enclosure window is offset", "u1"),
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "hidden chain of thought" },
          { type: "text", text: "the display stays on the board" },
        ],
      } as UIMessage,
      turn("user", "can you move the screen?", "u2"),
    ];

    await expect(shouldSuggestAiPing(messages)).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    const body = JSON.parse(String(init.body)) as {
      model: string;
      state: { chat: string };
      questions: { needs_ai: { type: string } };
    };
    expect(body.model).toBe("typesafe/jev-1.13");
    expect(body.questions.needs_ai.type).toBe("noul");
    expect(body.state.chat).toContain("user: the enclosure window is offset");
    expect(body.state.chat).toContain("assistant: the display stays on the board");
    expect(body.state.chat).toContain("user: can you move the screen?");
    expect(body.state.chat).not.toContain("hidden chain of thought");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk-or-test",
      "Content-Type": "application/json",
    });

    fetchMock.mockResolvedValueOnce(jevResponse(0.49));
    await expect(shouldSuggestAiPing([turn("user", "noted, shipping tomorrow")])).resolves.toBe(
      false,
    );
  });

  it("falls back to heuristics when Jev fails or the key is missing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    await expect(
      shouldSuggestAiPing([turn("user", "what thickness should the wall be?")]),
    ).resolves.toBe(true);
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    await expect(shouldSuggestAiPing([turn("user", "thanks")])).resolves.toBe(false);

    getServerEnv.mockReturnValue({ OPENROUTER_API_KEY: undefined, JEV_MODEL: "typesafe/jev-1.13" });
    fetchMock.mockClear();
    await expect(shouldSuggestAiPing([turn("user", "can you update the BOM?")])).resolves.toBe(
      true,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cleanedChatHistory", () => {
  it("keeps user and assistant text in order", () => {
    expect(
      cleanedChatHistory([
        turn("user", "hello", "1"),
        turn("assistant", "hi", "2"),
        turn("user", "design a lid", "3"),
      ]),
    ).toBe("user: hello\n\nassistant: hi\n\nuser: design a lid");
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
