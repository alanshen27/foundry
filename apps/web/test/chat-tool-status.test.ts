import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CANCELLED_TOOL_ERROR_TEXT } from "@/lib/copilot/messages";
vi.mock("@/components/copilot/copilot-provider", () => ({ useCopilot: vi.fn() }));
const { ToolCard, ToolCallGroup } = await import("@/components/copilot/chat-sidebar");
// Vitest's current JSX transform uses classic React; Next supplies it automatically.
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

const cancelled = {
  type: "tool-save_pcb",
  toolCallId: "stopped",
  state: "output-error",
  errorText: CANCELLED_TOOL_ERROR_TEXT,
};
const completed = {
  type: "tool-write_code_file",
  toolCallId: "done",
  state: "output-available",
  output: { ok: true },
};

describe("tool status after stopping", () => {
  it("renders an interrupted tool as stopped with no running spinner or success badge", () => {
    const html = renderToStaticMarkup(createElement(ToolCard, { part: cancelled }));
    expect(html).toContain("Stopped: save pcb");
    expect(html).toContain(CANCELLED_TOOL_ERROR_TEXT);
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("Failed to save PCB");
    expect(html).not.toContain("lucide-circle-check");
  });
  it("keeps completed work visible while a stopped batch never says Working", () => {
    const html = renderToStaticMarkup(
      createElement(ToolCallGroup, { parts: [completed, cancelled] }),
    );
    expect(html).toContain("Worked 1 tool · 1 stopped");
    expect(html).not.toContain("Working");
    expect(html).not.toContain("animate-spin");
  });
  it("still distinguishes actual failures and running tools", () => {
    const failure = { ...cancelled, errorText: "Engine validation failed" };
    const failed = renderToStaticMarkup(
      createElement(ToolCallGroup, { parts: [completed, failure] }),
    );
    expect(failed).toContain("1 failed");
    const pending = renderToStaticMarkup(
      createElement(ToolCallGroup, {
        parts: [completed, { ...cancelled, state: "input-available", errorText: undefined }],
      }),
    );
    expect(pending).toContain("1 running · 1 done");
    expect(pending).not.toContain("Working 2 tools");
    expect(pending).toContain("animate-spin");
  });
  it("reports the actual pending count alongside completed, failed, and stopped work", () => {
    const html = renderToStaticMarkup(
      createElement(ToolCallGroup, {
        parts: [
          completed,
          { ...completed, toolCallId: "done2" },
          cancelled,
          { ...cancelled, toolCallId: "failed", errorText: "Engine validation failed" },
          { ...cancelled, toolCallId: "pending", state: "input-available", errorText: undefined },
        ],
      }),
    );
    expect(html).toContain("1 running · 2 done · 1 failed · 1 stopped");
    expect(html).not.toContain("Working 5 tools");
  });
});
