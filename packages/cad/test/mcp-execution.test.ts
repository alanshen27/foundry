import { describe, expect, it, vi } from "vitest";
import { ZooMcpClient } from "../src/mcp";

function connectedClient() {
  const client = new ZooMcpClient({ token: "test-token" });
  const connection = { callTool: vi.fn() };
  const internals = client as unknown as { ensure(): Promise<typeof connection> };
  const ensure = vi.spyOn(internals, "ensure").mockResolvedValue(connection);
  return { client, connection, ensure };
}

describe("Zoo MCP execution results", () => {
  it.each([true, false])("reads the current structured result ok=%s", async (ok) => {
    const { client, connection } = connectedClient();
    const message = ok ? "KCL executes" : "Custom-function argument requires a label";
    connection.callTool.mockResolvedValue({
      structuredContent: { ok, message },
      content: [{ type: "text", text: JSON.stringify({ ok, message }) }],
    });
    expect(await client.executeKcl({ code: "shape = 1" })).toEqual(
      ok ? { ok: true, data: { message } } : { ok: false, error: message },
    );
  });

  it("reads a text-encoded false verdict even without a known error phrase", async () => {
    const { client, connection } = connectedClient();
    connection.callTool.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ ok: false, message: "Unknown function" }) }],
    });
    expect(await client.executeKcl({ code: "shape = 1" })).toEqual({
      ok: false,
      error: "Unknown function",
    });
  });

  it("retains legacy tuple failures", async () => {
    const { client, connection } = connectedClient();
    connection.callTool.mockResolvedValue({ structuredContent: [false, "KCL syntax error"] });
    expect(await client.executeKcl({ code: "shape = 1" })).toEqual({
      ok: false,
      error: "KCL syntax error",
    });
  });
});

describe.each([
  { method: "executeKcl", tool: "execute_kcl" },
  { method: "boundingBoxKcl", tool: "calculate_bounding_box_kcl" },
  { method: "multiviewSnapshotKcl", tool: "multiview_snapshot_of_kcl" },
] as const)("Zoo MCP $method cancellation", ({ method, tool }) => {
  it("does not connect or dispatch for an already cancelled caller", async () => {
    const { client, connection, ensure } = connectedClient();
    const signal = AbortSignal.abort(new Error("Caller stopped"));
    expect(await client[method]({ code: "shape = 1", signal })).toEqual({
      ok: false,
      error: "Caller stopped",
    });
    expect(ensure).not.toHaveBeenCalled();
    expect(connection.callTool).not.toHaveBeenCalled();
  });

  it("passes the caller signal to the SDK and discards a result arriving after cancellation", async () => {
    const { client, connection } = connectedClient();
    const controller = new AbortController();
    connection.callTool.mockImplementation(async () => {
      controller.abort(new Error("Caller stopped"));
      return { structuredContent: { ok: true, message: "Late success" } };
    });
    expect(await client[method]({ code: "shape = 1", signal: controller.signal })).toEqual({
      ok: false,
      error: "Caller stopped",
    });
    expect(connection.callTool).toHaveBeenCalledWith(
      { name: tool, arguments: expect.objectContaining({ kcl_code: "shape = 1" }) },
      undefined,
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("can cancel an in-progress call without closing the connection shared by other work", async () => {
    const { client, connection } = connectedClient();
    const controller = new AbortController();
    const close = vi.spyOn(client, "close");
    connection.callTool.mockImplementation(
      (_request, _schema, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), {
            once: true,
          });
        }),
    );
    const result = client[method]({ code: "shape = 1", signal: controller.signal });
    await vi.waitFor(() => expect(connection.callTool).toHaveBeenCalledOnce());
    controller.abort(new Error("Caller stopped"));
    expect(await result).toEqual({ ok: false, error: "Caller stopped" });
    expect(close).not.toHaveBeenCalled();
  });
});
