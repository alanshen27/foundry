// @vitest-environment jsdom
/**
 * The kickoff overlay's only real job: light up a checklist step once its
 * tool actually completes, and fade out once the run is done — not before,
 * since a viewer watching a live demo should never see a step "complete"
 * that the model never touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { PROJECT_KICKOFF_KEY } from "@/components/project-create-bar";

let mockStatus: "submitted" | "streaming" | "ready" | "error" = "ready";
let mockMessages: UIMessage[] = [];
const send = vi.fn();

vi.mock("@/components/copilot/copilot-provider", () => ({
  useCopilot: () => ({ send, status: mockStatus, messages: mockMessages }),
}));

const { PipelineKickoffListener } = await import("@/components/pipeline-kickoff");

function toolPart(name: string, state: string) {
  return { type: `tool-${name}`, state, toolCallId: name };
}

beforeEach(() => {
  mockStatus = "ready";
  mockMessages = [];
  send.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PipelineKickoffListener", () => {
  it("does nothing without a pending kickoff prompt", () => {
    render(<PipelineKickoffListener hasBrief={false} />);
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByText("Building your product…")).toBeNull();
  });

  it("fires the bootstrap prompt and shows the checklist overlay", async () => {
    sessionStorage.setItem(PROJECT_KICKOFF_KEY, "A pocket air quality monitor");
    render(<PipelineKickoffListener hasBrief={false} />);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![0]).toContain("A pocket air quality monitor");
    expect(screen.getByText("Building your product…")).toBeTruthy();
    // Consumed so a re-render doesn't fire it twice.
    expect(sessionStorage.getItem(PROJECT_KICKOFF_KEY)).toBeNull();
  });

  it("checks off a step once its tool's output is available, not before", async () => {
    sessionStorage.setItem(PROJECT_KICKOFF_KEY, "A pocket air quality monitor");
    const { rerender } = render(<PipelineKickoffListener hasBrief={false} />);
    await waitFor(() => expect(send).toHaveBeenCalled());

    // Requirements tool still streaming — not done yet.
    mockMessages = [
      {
        id: "m1",
        role: "assistant",
        parts: [toolPart("add_requirements", "input-streaming")],
      } as unknown as UIMessage,
    ];
    rerender(<PipelineKickoffListener hasBrief={false} />);
    const requirementsRow = screen.getByText("Requirements").closest("li")!;
    expect(requirementsRow.textContent).not.toContain("✓");

    // Now it completes.
    mockMessages = [
      {
        id: "m1",
        role: "assistant",
        parts: [toolPart("add_requirements", "output-available")],
      } as unknown as UIMessage,
    ];
    rerender(<PipelineKickoffListener hasBrief={false} />);
    await waitFor(() => {
      const row = screen.getByText("Requirements").closest("li")!;
      expect(row.querySelector("svg")).toBeTruthy();
    });
    // A step whose tool never ran stays unchecked.
    const bomRow = screen.getByText("BOM").closest("li")!;
    expect(bomRow.querySelector("svg")).toBeNull();
  });

  it("fades out once the run finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.setItem(PROJECT_KICKOFF_KEY, "A pocket air quality monitor");
    mockStatus = "ready";
    const { rerender } = render(<PipelineKickoffListener hasBrief={false} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Building your product…")).toBeTruthy();

    mockStatus = "streaming";
    rerender(<PipelineKickoffListener hasBrief={false} />);
    mockStatus = "ready";
    rerender(<PipelineKickoffListener hasBrief={false} />);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("Building your product…")).toBeNull();
  });
});
