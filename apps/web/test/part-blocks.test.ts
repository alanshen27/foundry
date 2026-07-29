import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { groupAssistantPartBlocks } from "@/lib/copilot/part-blocks";

function text(id: string, body: string): UIMessage["parts"][number] {
  return { type: "text", text: body } as UIMessage["parts"][number];
}

function tool(name: string, id: string): UIMessage["parts"][number] {
  return {
    type: `tool-${name}`,
    toolCallId: id,
    state: "output-available",
    input: {},
    output: {},
  } as UIMessage["parts"][number];
}

describe("groupAssistantPartBlocks", () => {
  it("collapses consecutive tools into one block", () => {
    const blocks = groupAssistantPartBlocks([
      text("t1", "Looking up…"),
      tool("get_project_state", "a"),
      tool("web_search", "b"),
      tool("add_components", "c"),
      text("t2", "Done."),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(["text", "tools", "text"]);
    expect(blocks[1]).toMatchObject({ type: "tools" });
    if (blocks[1]?.type === "tools") {
      expect(blocks[1].parts).toHaveLength(3);
    }
  });

  it("keeps separate tool batches when text sits between them", () => {
    const blocks = groupAssistantPartBlocks([
      tool("get_project_state", "a"),
      text("t1", "Next…"),
      tool("web_search", "b"),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(["tools", "text", "tools"]);
  });

  it("ignores empty text between tools so parallel calls stay one group", () => {
    const blocks = groupAssistantPartBlocks([
      tool("get_project_state", "a"),
      text("empty", "   "),
      tool("web_search", "b"),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("tools");
    if (blocks[0]?.type === "tools") {
      expect(blocks[0].parts).toHaveLength(2);
    }
  });
});
