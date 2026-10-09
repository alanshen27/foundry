// @vitest-environment jsdom
/**
 * The PCB workspace — at 2,500 lines the largest component in the app — had no
 * rendering test at all. These cover what a person does with it: open a
 * saved board, place a footprint, edit it, undo, and trust that what they did
 * is saved and that a viewer cannot change anything.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EMPTY_PCB } from "@/lib/pcb/doc";
import { createTrpcMock, type TrpcMock } from "./utils/trpc-mock";

let mock: TrpcMock;
vi.mock("@/lib/trpc", () => ({
  get trpc() {
    return mock.trpc;
  },
}));
// The 3D preview needs WebGL, and loads lazily in the app anyway.
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const { PcbCanvas } = await import("@/components/engineer/pcb-canvas");

const savedBoard = {
  version: 2,
  activeBoardId: "board-1",
  boards: [
    {
      ...EMPTY_PCB,
      id: "board-1",
      name: "Main board",
      footprints: [
        {
          id: "fp-r1",
          libraryId: "R_0603",
          refDes: "R1",
          value: "220",
          xMm: 20,
          yMm: 15,
          rotationDeg: 0,
          side: "front",
        },
      ],
    },
  ],
};

type SaveInput = {
  kind: string;
  data: { boards: { footprints: { refDes: string; standoffMm?: number }[] }[] };
};
const saves = () =>
  mock.mutationCalls.filter((c) => c.path === "design.save").map((c) => c.input as SaveInput);

beforeEach(() => {
  mock = createTrpcMock();
  mock.query("design.get", (input) =>
    (input as { kind: string }).kind === "PCB" ? { data: { data: savedBoard } } : { data: null },
  );
  mock.query("project.viewer", { data: { id: "user1", name: "Builder" } });
  // No collaboration server: single-player autosave.
  mock.query("collaboration.designSession", { data: null });
  // jsdom has no layout, so give the canvas a size to fit the board into.
  Element.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 900,
      bottom: 600,
      width: 900,
      height: 600,
      toJSON: () => ({}),
    };
  };
});

function renderCanvas(canEdit = true) {
  return render(<PcbCanvas projectId="proj1" branchId="branch1" canEdit={canEdit} />);
}

describe("PcbCanvas", () => {
  it("opens the saved board with its footprints", () => {
    renderCanvas();
    const canvas = screen.getByLabelText("PCB board canvas");
    expect(within(canvas).getAllByText("R1").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Active board")).toHaveDisplayValue("Main board");
  });

  it("shows the saved board read-only while the live room is still connecting", async () => {
    mock.query("collaboration.designSession", { data: undefined });
    renderCanvas();
    const canvas = screen.getByLabelText("PCB board canvas");
    expect(within(canvas).getAllByText("R1").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Search footprints")).toBeDisabled();
    await new Promise((r) => setTimeout(r, 1_000));
    expect(saves()).toEqual([]);
  });

  it("places a footprint from the library, selects it, and saves the board", async () => {
    const user = userEvent.setup();
    renderCanvas();
    await user.type(screen.getByLabelText("Search footprints"), "0805");
    const entry = screen.getAllByRole("button").find((b) => /0805/.test(b.textContent ?? ""));
    expect(entry, "a 0805 footprint in the library").toBeDefined();
    await user.click(entry!);

    // The new part is selected, so its inspector is open.
    const refDes = await screen.findByLabelText("Reference designator");
    expect((refDes as HTMLInputElement).value).not.toBe("R1");

    // Saves are debounced; the write carries the whole board set.
    await waitFor(() => expect(saves().length).toBeGreaterThan(0), { timeout: 3_000 });
    const last = saves().at(-1)!;
    expect(last.kind).toBe("PCB");
    expect(last.data.boards[0]!.footprints.map((f) => f.refDes)).toContain("R1");
    expect(last.data.boards[0]!.footprints).toHaveLength(2);
  });

  it("filters the footprint library as you type", async () => {
    const user = userEvent.setup();
    renderCanvas();
    const libraryButtons = () =>
      screen.getAllByRole("button").filter((b) => / mm$/.test(b.textContent?.trim() ?? ""));
    const before = libraryButtons().length;
    await user.type(screen.getByLabelText("Search footprints"), "zzz-no-such-package");
    expect(libraryButtons().length).toBeLessThan(before);
    expect(libraryButtons()).toHaveLength(0);
  });

  it("undoes a placement", async () => {
    const user = userEvent.setup();
    renderCanvas();
    const countRefs = () =>
      within(screen.getByLabelText("PCB board canvas")).queryAllByText(/^[A-Z]+\d+$/).length;
    const before = countRefs();
    const entry = screen
      .getAllByRole("button")
      .find((b) => / mm$/.test(b.textContent?.trim() ?? ""))!;
    await user.click(entry);
    await waitFor(() => expect(countRefs()).toBeGreaterThan(before));
    await user.click(screen.getByTitle("Undo (Ctrl/Cmd+Z)"));
    await waitFor(() => expect(countRefs()).toBe(before));
  });

  it("renames the selected footprint through the inspector", async () => {
    const user = userEvent.setup();
    renderCanvas();
    const entry = screen
      .getAllByRole("button")
      .find((b) => / mm$/.test(b.textContent?.trim() ?? ""))!;
    await user.click(entry);
    const refDes = await screen.findByLabelText("Reference designator");
    await user.clear(refDes);
    await user.type(refDes, "U7");
    await waitFor(
      () =>
        expect(
          saves()
            .at(-1)
            ?.data.boards[0]!.footprints.map((f) => f.refDes),
        ).toContain("U7"),
      { timeout: 3_000 },
    );
  });

  it("raises the selected footprint with a standoff", async () => {
    const user = userEvent.setup();
    renderCanvas();
    const entry = screen
      .getAllByRole("button")
      .find((b) => / mm$/.test(b.textContent?.trim() ?? ""))!;
    await user.click(entry);
    await user.type(await screen.findByLabelText("Standoff above board in millimetres"), "8.5");
    await waitFor(
      () =>
        expect(
          saves()
            .at(-1)
            ?.data.boards[0]!.footprints.map((f) => f.standoffMm),
        ).toContain(8.5),
      { timeout: 3_000 },
    );
  });

  describe("for someone who can only view", () => {
    it("disables the library and never saves", async () => {
      renderCanvas(false);
      expect(screen.getByLabelText("Search footprints")).toBeDisabled();
      const library = screen
        .getAllByRole("button")
        .filter((b) => / mm$/.test(b.textContent?.trim() ?? ""));
      expect(library.length).toBeGreaterThan(0);
      for (const button of library) expect(button).toBeDisabled();
      await new Promise((r) => setTimeout(r, 1_000));
      expect(saves()).toEqual([]);
    });
  });
});
