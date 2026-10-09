// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createTrpcMock, type TrpcMock } from "./utils/trpc-mock";

let mock: TrpcMock;
vi.mock("@/lib/trpc", () => ({
  get trpc() {
    return mock.trpc;
  },
}));

type Callbacks = {
  onStatus: (e: { status: string }) => void;
  onSynced: (e: { state: boolean }) => void;
};
let provider: Callbacks;
vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    awareness = { setLocalStateField: vi.fn() };
    constructor(options: Callbacks) {
      provider = options;
    }
    destroy() {}
  },
}));

const { useCollaborativeDesign } = await import("@/components/engineer/use-collaborative-design");

const session = {
  url: "ws://collab.test",
  documentName: "design:p:b:PCB",
  token: "t",
  canEdit: true,
  user: { id: "u", name: "U" },
};

beforeEach(() => {
  mock = createTrpcMock();
  mock.query("collaboration.designSession", { data: session });
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("useCollaborativeDesign", () => {
  it("keeps live state through a blip but falls back to committed data when the room stays down", () => {
    const { result } = renderHook(() =>
      useCollaborativeDesign({
        projectId: "p",
        branchId: "b",
        kind: "PCB",
        canEdit: true,
        onRemoteData: () => undefined,
      }),
    );
    expect(result.current.awaitingLive).toBe(true);
    act(() => {
      provider.onStatus({ status: "connected" });
      provider.onSynced({ state: true });
    });
    expect(result.current.awaitingLive).toBe(false);

    act(() => provider.onStatus({ status: "disconnected" }));
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.awaitingLive).toBe(false);

    const before = mock.invalidations.length;
    act(() => vi.advanceTimersByTime(2_500));
    expect(result.current.awaitingLive).toBe(true);
    expect(result.current.canEdit).toBe(false);
    expect(mock.invalidations.slice(before)).toContainEqual({
      path: "design.get",
      input: { projectId: "p", branchId: "b" },
    });

    act(() => {
      provider.onStatus({ status: "connected" });
      provider.onSynced({ state: true });
    });
    expect(result.current.awaitingLive).toBe(false);
  });
});
