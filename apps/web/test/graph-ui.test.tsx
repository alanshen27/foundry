// @vitest-environment jsdom
/**
 * The places the product graph surfaces outside the impact panel: the stale
 * badge, the BOM row that opens the panel, the Sourcing tab it lives in, the
 * fit-check findings that link to responsible artifacts, and the error
 * boundary that keeps a crash in any of these recoverable.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTrpcMock, type TrpcMock } from "./utils/trpc-mock";

let mock: TrpcMock;
vi.mock("@/lib/trpc", () => ({
  get trpc() {
    return mock.trpc;
  },
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const reportClientError = vi.fn();
vi.mock("@/lib/report-client-error", () => ({
  reportClientError: (...a: unknown[]) => reportClientError(...a),
}));

const { StaleBadge } = await import("@/components/graph/stale-badge");
const { BomTable } = await import("@/components/engineer/bom-table");
const { SourcingPanel } = await import("@/components/engineer/sourcing-panel");
const { FitCheckPanel } = await import("@/components/verify/fit-check-panel");
const { default: SegmentError } = await import("@/app/error");

const component = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "c1",
  discipline: "ELECTRONICS",
  name: "Battery, LiPo 2000 mAh",
  refDes: "BT1",
  manufacturer: null,
  partNumber: null,
  quantity: 1,
  unitCostCents: 899,
  sourceUrl: null,
  imageUrl: null,
  ...over,
});

beforeEach(() => {
  mock = createTrpcMock();
  mock.query("graph.staleNodes", { data: [] });
  refresh.mockReset();
  reportClientError.mockReset();
});

describe("StaleBadge", () => {
  it("renders nothing for an artifact that is not flagged", () => {
    const { container } = render(<StaleBadge node={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says Review for a structural link, with the reason on hover", () => {
    render(
      <StaleBadge
        node={{
          id: "n1",
          refKey: "requirement:r1",
          label: "Operating time",
          staleReason: "is satisfied by BT1",
          staleConfidence: 1,
        }}
      />,
    );
    const badge = screen.getByText("Review");
    expect(badge.closest("span")).toHaveAttribute(
      "title",
      "Needs another look — is satisfied by BT1",
    );
  });

  it("softens its wording for a chain of guesses", () => {
    render(
      <StaleBadge
        node={{
          id: "n1",
          refKey: "cadpart:x",
          label: "bay",
          staleReason: null,
          staleConfidence: 0.5,
        }}
      />,
    );
    expect(screen.getByText("Possibly affected")).toBeInTheDocument();
  });
});

describe("BomTable", () => {
  const table = (props: Partial<{ canEdit: boolean }> = {}) =>
    render(
      <BomTable
        projectId="proj1"
        branchId="branch1"
        canEdit={props.canEdit ?? true}
        discipline="ELECTRONICS"
        components={[component(), component({ id: "c2", name: "Arduino Nano", refDes: "U1" })]}
      />,
    );

  it("badges the rows the graph has flagged, and only those", () => {
    mock.query("graph.staleNodes", {
      data: [
        {
          id: "n2",
          refKey: "component:c2",
          label: "U1 Arduino Nano",
          staleReason: "is powered by BT1",
          staleConfidence: 1,
        },
      ],
    });
    table();
    expect(
      within(screen.getByRole("row", { name: /Arduino Nano/ })).getByText("Review"),
    ).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Battery/ })).queryByText("Review")).toBeNull();
  });

  it("opens the impact panel for a row, above the page, and closes it", async () => {
    mock.query("graph.impact", { data: { root: { id: "n1" }, impacted: [] } });
    const user = userEvent.setup();
    const { container } = table();
    await user.click(
      screen.getByRole("button", { name: "What depends on Battery, LiPo 2000 mAh?" }),
    );

    const dialog = screen.getByRole("dialog");
    // Portalled to <body>: inside the workspace's z-10 tab layer the panel
    // rendered beneath the header and its close button could not be clicked.
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    expect(within(dialog).getByText("BT1 · Battery, LiPo 2000 mAh")).toBeInTheDocument();
    expect(mock.queryCalls).toContainEqual({
      path: "graph.impact",
      input: { projectId: "proj1", branchId: "branch1", refKey: "component:c1" },
    });

    await user.click(within(dialog).getAllByRole("button", { name: "Close impact panel" })[0]!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets a viewer see what depends on a part but not change the BOM", () => {
    table({ canEdit: false });
    expect(screen.getAllByRole("button", { name: /What depends on/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Component name")).not.toBeInTheDocument();
  });

  it("adds a part and clears the form", async () => {
    const user = userEvent.setup();
    table();
    await user.type(screen.getByLabelText("Component name"), "BME680 sensor");
    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "2");
    await user.type(screen.getByLabelText("Unit cost"), "18");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(mock.mutationCalls).toContainEqual({
      path: "engineer.createComponent",
      input: expect.objectContaining({
        name: "BME680 sensor",
        quantity: 2,
        unitCostCents: 1800,
        discipline: "ELECTRONICS",
      }),
    });
    expect(await screen.findByLabelText("Component name")).toHaveValue("");
  });
});

describe("SourcingPanel", () => {
  it("splits the BOM by discipline", () => {
    mock.query("engineer.listComponents", {
      data: [
        component(),
        component({ id: "m1", discipline: "MECHANICAL", name: "M3 screw", refDes: null }),
      ],
    });
    render(<SourcingPanel projectId="proj1" branchId="branch1" canEdit />);
    const [electronics, mechanical] = screen.getAllByRole("heading", { level: 2 });
    expect(electronics).toHaveTextContent("Electronics");
    expect(mechanical).toHaveTextContent("Mechanical");
    const rows = (heading: HTMLElement) =>
      within(heading.parentElement!)
        .queryAllByRole("row")
        .map((r) => r.textContent ?? "");
    expect(rows(electronics!).some((r) => r.includes("Battery, LiPo 2000 mAh"))).toBe(true);
    expect(rows(mechanical!).some((r) => r.includes("M3 screw"))).toBe(true);
    expect(rows(electronics!).some((r) => r.includes("M3 screw"))).toBe(false);
  });
});

describe("FitCheckPanel", () => {
  it("links a graph-backed finding straight to the responsible artifacts", () => {
    mock.query("verify.fitCheck", {
      data: {
        ok: false,
        counts: { errors: 1, warnings: 0 },
        simulation: { ran: false, reason: "No firmware" },
        findings: [
          {
            domain: "CROSS_DOMAIN",
            severity: "error",
            message: 'MUST requirement "Reports temperature" has nothing that verifies it.',
            nodes: [
              { refKey: "requirement:r3", label: "Reports temperature" },
              { refKey: "codefile:f1", label: "src/main.cpp" },
            ],
          },
        ],
      },
    });
    render(<FitCheckPanel projectId="proj1" branchId="branch1" />);
    expect(screen.getByRole("link", { name: "Reports temperature" })).toHaveAttribute(
      "href",
      "?view=ideate",
    );
    expect(screen.getByRole("link", { name: "src/main.cpp" })).toHaveAttribute(
      "href",
      "?view=code",
    );
  });

  it("only runs the simulation when asked", async () => {
    const user = userEvent.setup();
    render(<FitCheckPanel projectId="proj1" branchId="branch1" />);
    expect(mock.refetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Run check/ }));
    expect(mock.refetch).toHaveBeenCalledOnce();
  });
});

describe("the route error boundary", () => {
  it("reports the crash once and offers a retry", async () => {
    const reset = vi.fn();
    const user = userEvent.setup();
    const error = Object.assign(new Error("render failed"), { digest: "d1g3st" });
    render(<SegmentError error={error} reset={reset} />);
    expect(reportClientError).toHaveBeenCalledWith(error, "segment");
    expect(screen.getByText("ref d1g3st")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Try again/ }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
