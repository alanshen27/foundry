// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTrpcMock, type TrpcMock } from "./utils/trpc-mock";

let mock: TrpcMock;
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/trpc", () => ({
  get trpc() {
    return mock.trpc;
  },
}));

const { WorkspaceManager } = await import("@/components/workspace-manager");
const workspaces = [
  { id: "owned", name: "Workshop", slug: "workshop", canManage: true },
  { id: "shared", name: "Shared studio", slug: "shared-studio", canManage: false },
];

function renderManager(open = true) {
  const onOpenChange = vi.fn();
  const onWorkspaceChanged = vi.fn();
  const view = render(
    <WorkspaceManager
      open={open}
      onOpenChange={onOpenChange}
      workspaces={workspaces}
      current={workspaces[0]}
      onWorkspaceChanged={onWorkspaceChanged}
    />,
  );
  return { ...view, onOpenChange, onWorkspaceChanged };
}

beforeEach(() => {
  mock = createTrpcMock();
  mock.query("workspace.list", { data: workspaces });
  navigation.push.mockReset();
  navigation.refresh.mockReset();
});

describe("inline workspace management", () => {
  it("does not query workspaces while closed", () => {
    renderManager(false);
    expect(mock.queryCalls).toHaveLength(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows rename only for manageable workspaces and keeps opening explicit", () => {
    renderManager();
    expect(screen.getByRole("button", { name: "Rename Workshop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename Shared studio" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open workspace Shared studio" })).toHaveAttribute(
      "href",
      "/w/shared-studio",
    );
  });

  it("renames in place, refreshes labels, and keeps the dialog open", async () => {
    const user = userEvent.setup();
    mock.mutation("workspace.rename", (input) => ({
      id: "owned",
      name: (input as { name: string }).name,
      slug: "workshop",
    }));
    const { onOpenChange, onWorkspaceChanged } = renderManager();
    await user.click(screen.getByRole("button", { name: "Rename Workshop" }));
    const input = screen.getByRole("textbox", { name: "Workspace name for Workshop" });
    await user.clear(input);
    await user.type(input, "  Hardware studio  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("link", { name: "Open workspace Hardware studio" }),
    ).toHaveAttribute("href", "/w/workshop");
    expect(mock.mutationCalls).toEqual([
      { path: "workspace.rename", input: { workspaceId: "owned", name: "Hardware studio" } },
    ]);
    expect(onWorkspaceChanged).toHaveBeenCalledWith({
      id: "owned",
      name: "Hardware studio",
      slug: "workshop",
    });
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("creates in place and adds an explicit link without switching workspace", async () => {
    const user = userEvent.setup();
    mock.mutation("workspace.create", (input) => ({
      id: "new",
      name: (input as { name: string }).name,
      slug: "robotics",
    }));
    const { onOpenChange } = renderManager();
    const input = screen.getByRole("textbox", { name: "New workspace" });
    await user.type(input, "Robotics");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("link", { name: "Open workspace Robotics" })).toHaveAttribute(
      "href",
      "/w/robotics",
    );
    expect(screen.getByRole("button", { name: "Rename Robotics" })).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mock.invalidations).toContainEqual({ path: "workspace.list", input: undefined });
  });

  it("retains a failed rename draft and clears its error on cancel", async () => {
    const user = userEvent.setup();
    mock.mutation("workspace.rename", () => {
      throw new Error("You no longer have permission to rename this workspace.");
    });
    const { onOpenChange } = renderManager();
    await user.click(screen.getByRole("button", { name: "Rename Workshop" }));
    const input = screen.getByRole("textbox", { name: "Workspace name for Workshop" });
    await user.clear(input);
    await user.type(input, "New name");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer have permission");
    expect(input).toHaveValue("New name");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(navigation.refresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Workshop" })).toBeInTheDocument();
  });

  it("retains a failed create draft without closing or navigating", async () => {
    const user = userEvent.setup();
    mock.mutation("workspace.create", () => {
      throw new Error("Unable to create this workspace.");
    });
    const { onOpenChange } = renderManager();
    const input = screen.getByRole("textbox", { name: "New workspace" });
    await user.type(input, "Robotics");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to create");
    expect(input).toHaveValue("Robotics");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("keeps fallback labels read-only on a load failure and offers retry", async () => {
    const user = userEvent.setup();
    mock.query("workspace.list", { error: { message: "Offline" } });
    renderManager();
    expect(screen.getByRole("alert")).toHaveTextContent("Offline");
    expect(screen.getByRole("link", { name: "Open workspace Workshop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename Workshop" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mock.refetch).toHaveBeenCalledOnce());
  });
});
