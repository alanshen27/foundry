import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZookeeperPromptOptions } from "../src/zookeeper";

const zookeeperPrompt = vi.fn();
vi.mock("../src/zookeeper", () => ({ zookeeperPrompt }));

const { createZooCadAdapter } = await import("../src/zoo");

describe("textToCadProject", () => {
  beforeEach(() => {
    zookeeperPrompt.mockReset();
  });

  it("keeps every file of a multi-file assembly", async () => {
    zookeeperPrompt.mockResolvedValue({
      ok: true,
      data: {
        files: {
          "main.kcl": 'import leaf from "leaf.kcl"\n',
          "leaf.kcl": "leaf = 1\n",
          "pin.kcl": "pin = 1\n",
        },
        conversationId: "conv-1",
        promptId: "prompt-1",
      },
    });

    const result = await createZooCadAdapter({ token: "t" }).textToCadProject("a hinge");

    expect(result).toEqual({
      ok: true,
      data: {
        files: {
          "main.kcl": 'import leaf from "leaf.kcl"\n',
          "leaf.kcl": "leaf = 1\n",
          "pin.kcl": "pin = 1\n",
        },
        id: "prompt-1",
      },
    });
    const opts = zookeeperPrompt.mock.calls[0]![0] as ZookeeperPromptOptions;
    expect(opts.forcedTools).toEqual(["text_to_cad"]);
  });

  it("drops blank files and fails when nothing is left", async () => {
    zookeeperPrompt.mockResolvedValue({
      ok: true,
      data: { files: { "main.kcl": "   " }, conversationId: "conv-2" },
    });

    const result = await createZooCadAdapter({ token: "t" }).textToCadProject("a cube");

    expect(result.ok).toBe(false);
  });

  it("rejects an empty prompt without calling Zoo", async () => {
    const result = await createZooCadAdapter({ token: "t" }).textToCadProject("  ");

    expect(result.ok).toBe(false);
    expect(zookeeperPrompt).not.toHaveBeenCalled();
  });
});
