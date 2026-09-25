// @vitest-environment jsdom
/**
 * The impact panel is the demo moment, so it is tested as a user sees it:
 * rendered, clicked, and fed the real traversal of the environmental monitor
 * rather than a hand-shaped object that could drift from what the server
 * actually returns.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { deriveGraph } from "@/lib/graph/derive";
import { impactFrom } from "@/lib/graph/impact";
import type { GraphEdge, GraphSnapshot } from "@/lib/graph/types";
import { createTrpcMock, type TrpcMock } from "./utils/trpc-mock";
import { authoredEdges, envMonitorInput } from "./fixtures/env-monitor";

let mock: TrpcMock;
vi.mock("@/lib/trpc", () => ({
  get trpc() {
    return mock.trpc;
  },
}));

// The graph view is ReactFlow behind next/dynamic; jsdom has no layout to run
// it in, so the stub just shows what it was asked to draw.
vi.mock("next/dynamic", () => ({
  default: () =>
    function ImpactGraphStub(props: { impacted: unknown[]; includeStructural: boolean }) {
      return (
        <div data-testid="impact-graph">
          {props.impacted.length} nodes, structural {String(props.includeStructural)}
        </div>
      );
    },
}));

const { ImpactPanel } = await import("@/components/graph/impact-panel");

function graph(): GraphSnapshot {
  const derived = deriveGraph(envMonitorInput);
  return {
    nodes: derived.nodes.map((n, i) => ({ ...n, id: `n${i}` })),
    edges: [
      ...derived.edges.map((e, i) => ({ ...e, id: `e${i}` })),
      ...authoredEdges.map((e, i) => ({ ...e, id: `a${i}`, rule: null }) as GraphEdge),
    ],
  };
}

const ROOT = "component:cmp-battery";

function impactFor(snapshot: GraphSnapshot) {
  return {
    root: snapshot.nodes.find((n) => n.refKey === ROOT) ?? null,
    impacted: impactFrom(snapshot, ROOT),
  };
}

function renderPanel(props: Partial<{ canEdit: boolean; onClose: () => void }> = {}) {
  return render(
    <ImpactPanel
      projectId="proj1"
      branchId="branch1"
      refKey={ROOT}
      title="BT1 · Battery, LiPo 2000 mAh"
      canEdit={props.canEdit ?? true}
      onClose={props.onClose ?? (() => {})}
    />,
  );
}

beforeEach(() => {
  mock = createTrpcMock();
  mock.query("graph.impact", { data: impactFor(graph()) });
});

describe("ImpactPanel", () => {
  it("opens on the artifacts a person acts on, requirements first", () => {
    renderPanel();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe("Requirements");
    expect(headings).toContain("Firmware");
    // Wiring intermediates are folded away until asked for.
    expect(headings).not.toContain("Nets");
    expect(screen.queryByRole("link", { name: "net LED_CTRL" })).not.toBeInTheDocument();
  });

  it("counts actionable artifacts separately from the wiring they travel through", () => {
    const { impacted } = impactFor(graph());
    const structural = impacted.filter((n) =>
      ["CIRCUIT_PART", "NET", "MCU_PIN", "FOOTPRINT"].includes(n.kind),
    ).length;
    renderPanel();
    expect(
      screen.getByText(
        `${impacted.length - structural} artifacts would need another look, through ${structural} wiring links.`,
      ),
    ).toBeInTheDocument();
  });

  it("reveals and hides the wiring links on request", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /Show \d+ wiring links/ }));
    expect(screen.getByRole("link", { name: "net LED_CTRL" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Hide \d+ wiring links/ }));
    expect(screen.queryByRole("link", { name: "net LED_CTRL" })).not.toBeInTheDocument();
  });

  it("shows why each artifact is affected, and links to where it lives", () => {
    renderPanel();
    const firmware = screen.getByRole("link", { name: "src/main.cpp" });
    expect(firmware).toHaveAttribute("href", "?view=code");
    const row = firmware.closest("li")!;
    expect(within(row).getByText("drives U1 pin D2")).toBeInTheDocument();
    // The full breadcrumb back to the battery is the evidence for the claim.
    expect(row).toHaveTextContent("BT1 Battery, LiPo 2000 mAh");
    expect(row).toHaveTextContent("net LED_CTRL");
  });

  it("labels a name-based guess as Likely rather than certain", () => {
    renderPanel();
    const bay = screen.getByRole("link", { name: "parts/battery-bay.kcl" }).closest("li")!;
    expect(within(bay).getByText("Likely")).toBeInTheDocument();
    const mcu = screen.getByRole("link", { name: "U1 Arduino Nano controller" }).closest("li")!;
    expect(within(mcu).getByText("Review")).toBeInTheDocument();
  });

  it("flags the impacted artifacts and refreshes the badges elsewhere", async () => {
    const user = userEvent.setup();
    mock.mutation("graph.markImpacted", () => ({ marked: 7, impacted: [] }));
    renderPanel();
    await user.click(screen.getByRole("button", { name: /Flag these for review/ }));
    expect(await screen.findByRole("button", { name: "Flagged 7 for review" })).toBeDisabled();
    expect(mock.mutationCalls).toContainEqual({
      path: "graph.markImpacted",
      input: { projectId: "proj1", branchId: "branch1", refKey: ROOT },
    });
    expect(mock.invalidations.map((i) => i.path)).toContain("graph.staleNodes");
  });

  it("hides the flag action from someone who cannot edit", () => {
    renderPanel({ canEdit: false });
    expect(screen.queryByRole("button", { name: /Flag these/ })).not.toBeInTheDocument();
  });

  it("closes", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderPanel({ onClose });
    await user.click(screen.getByRole("button", { name: "Close impact panel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("ImpactPanel graph view", () => {
  it("switches between the list and the picture", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByRole("button", { name: "list" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("impact-graph")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "graph" }));
    expect(screen.getByRole("button", { name: "graph" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("impact-graph")).toHaveTextContent("structural false");
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();

    // The wiring toggle drives the picture too.
    await user.click(screen.getByRole("button", { name: /Show \d+ wiring links/ }));
    expect(screen.getByTestId("impact-graph")).toHaveTextContent("structural true");

    await user.click(screen.getByRole("button", { name: "list" }));
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(0);
  });
});

describe("ImpactPanel on a project with no graph yet", () => {
  beforeEach(() => {
    mock.query("graph.impact", { data: { root: null, impacted: [] } });
  });

  it("builds the graph once, instead of claiming nothing depends on the part", async () => {
    renderPanel();
    await waitFor(() =>
      expect(mock.mutationCalls.filter((c) => c.path === "graph.sync")).toHaveLength(1),
    );
    expect(screen.queryByText("Nothing downstream depends on this yet.")).not.toBeInTheDocument();
    expect(mock.invalidations.map((i) => i.path)).toContain("graph.impact");
  });

  it("explains, without building, to someone who cannot edit", () => {
    renderPanel({ canEdit: false });
    expect(screen.getByText(/has not been built yet/)).toBeInTheDocument();
    expect(mock.mutationCalls).toEqual([]);
  });

  it("reports a failed build rather than spinning forever", async () => {
    mock.mutation("graph.sync", () => {
      throw new Error("derive exploded");
    });
    renderPanel();
    expect(
      await screen.findByText(/Could not build the product graph: derive exploded/),
    ).toBeInTheDocument();
  });
});

describe("ImpactPanel with a graph where nothing depends on the part", () => {
  it("says so, and explains which links have to be drawn by hand", () => {
    const snapshot = graph();
    mock.query("graph.impact", {
      data: { root: snapshot.nodes.find((n) => n.refKey === ROOT), impacted: [] },
    });
    renderPanel();
    expect(screen.getByText("Nothing downstream depends on this yet.")).toBeInTheDocument();
    expect(screen.getByText(/have to be drawn, by you or by the copilot/)).toBeInTheDocument();
  });
});
