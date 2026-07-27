import { describe, expect, it } from "vitest";
import {
  filterMentionTargets,
  insertMention,
  mentionQueryAt,
  mentionsAi,
  splitMentions,
} from "@/lib/copilot/mentions";

describe("mentionsAi", () => {
  it("detects @AI as a word", () => {
    expect(mentionsAi("@AI design a box")).toBe(true);
    expect(mentionsAi("hey @ai please help")).toBe(true);
    expect(mentionsAi("email me@ai.com")).toBe(false);
    expect(mentionsAi("no mention here")).toBe(false);
  });
});

describe("mentionQueryAt", () => {
  it("finds an active @query at the caret", () => {
    expect(mentionQueryAt("hello @A", 8)).toEqual({ start: 6, query: "A" });
    expect(mentionQueryAt("hello world", 11)).toBeNull();
  });
});

describe("insertMention", () => {
  it("replaces the active query with @AI", () => {
    const result = insertMention("ask @a", 6, filterMentionTargets("a")[0]!);
    expect(result.text).toBe("ask @AI ");
    expect(result.caret).toBe(8);
  });
});

describe("splitMentions", () => {
  it("highlights AI tokens", () => {
    expect(splitMentions("Hi @AI there")).toEqual([
      { kind: "text", text: "Hi " },
      { kind: "mention", text: "@AI", invokesAi: true },
      { kind: "text", text: " there" },
    ]);
  });
});
