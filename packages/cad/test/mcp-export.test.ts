import { access, mkdtemp, truncate, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZooMcpClient } from "../src/mcp";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>();
  return { ...original, mkdtemp: vi.fn(original.mkdtemp) };
});

function minimalGlb(): Buffer {
  const json = Buffer.from('{"asset":{"version":"2.0"}} ');
  const glb = Buffer.alloc(20 + json.length);
  glb.write("glTF", 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  return glb;
}

const succeeded = { ok: true as const, data: { text: "Exported", images: [] } };

async function expectRemoved(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(dirname(path))).rejects.toMatchObject({ code: "ENOENT" });
}

describe("Zoo MCP GLB export", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns actual GLB bytes and removes the export file and temporary directory", async () => {
    const client = new ZooMcpClient({ token: "test-token" });
    const glb = minimalGlb();
    let output = "";
    const call = vi.spyOn(client, "callGenericTool").mockImplementationOnce(async (_name, args) => {
      output = String(args.export_path);
      await writeFile(output, glb);
      return succeeded;
    });

    expect(await client.exportGlb({ code: "partWidth = 20" })).toEqual({ ok: true, data: { glb } });
    expect(call).toHaveBeenCalledWith(
      "export_kcl",
      {
        kcl_code: "partWidth = 20",
        export_format: "glb",
        export_path: output,
      },
      undefined,
    );
    await expectRemoved(output);
  });

  it("passes a project directory and caller signal to the exporter", async () => {
    const client = new ZooMcpClient({ token: "test-token" });
    const controller = new AbortController();
    let output = "";
    const call = vi.spyOn(client, "callGenericTool").mockImplementationOnce(async (_name, args) => {
      output = String(args.export_path);
      await writeFile(output, minimalGlb());
      return succeeded;
    });

    const result = await client.exportGlb({
      code: "ignored when projectDir is provided",
      projectDir: "/workspace/project",
      signal: controller.signal,
    });
    expect(result.ok).toBe(true);
    expect(call).toHaveBeenCalledWith(
      "export_kcl",
      {
        kcl_path: "/workspace/project",
        export_format: "glb",
        export_path: output,
      },
      controller.signal,
    );
    await expectRemoved(output);
  });

  it("rejects a plain-text engine failure with no output and ignores returned paths", async () => {
    const client = new ZooMcpClient({ token: "test-token" });
    let output = "";
    vi.spyOn(client, "callGenericTool").mockImplementationOnce(async (_name, args) => {
      output = String(args.export_path);
      return {
        ok: true,
        data: {
          text: "KCL failed; use /some/other/model.glb",
          images: [],
          structured: { export_path: "/some/other/model.glb" },
        },
      };
    });

    expect(await client.exportGlb({ code: "broken KCL" })).toEqual({
      ok: false,
      error: "CAD engine did not produce a usable GLB model",
    });
    await expectRemoved(output);
  });

  it("preserves a reported MCP error and still cleans up temporary files", async () => {
    const client = new ZooMcpClient({ token: "test-token" });
    let output = "";
    vi.spyOn(client, "callGenericTool").mockImplementationOnce(async (_name, args) => {
      output = String(args.export_path);
      await writeFile(output, minimalGlb());
      return { ok: false, error: "KCL compile failed at line 2" };
    });

    expect(await client.exportGlb({ code: "broken KCL" })).toEqual({
      ok: false,
      error: "KCL compile failed at line 2",
    });
    await expectRemoved(output);
  });

  it.each([
    { name: "magic", change: (glb: Buffer) => glb.write("oops", 0) },
    { name: "version", change: (glb: Buffer) => glb.writeUInt32LE(1, 4) },
    { name: "declared length", change: (glb: Buffer) => glb.writeUInt32LE(glb.length + 4, 8) },
  ])("rejects GLB with an invalid $name and removes it", async ({ change }) => {
    const client = new ZooMcpClient({ token: "test-token" });
    const glb = minimalGlb();
    change(glb);
    let output = "";
    vi.spyOn(client, "callGenericTool").mockImplementationOnce(async (_name, args) => {
      output = String(args.export_path);
      await writeFile(output, glb);
      return succeeded;
    });

    expect(await client.exportGlb({ code: "partWidth = 20" })).toEqual({
      ok: false,
      error: "CAD engine returned an invalid GLB model",
    });
    await expectRemoved(output);
  });

  it.each([10, 25_000_001])(
    "rejects an unusable file size of %s bytes before reading the model",
    async (size) => {
      const client = new ZooMcpClient({ token: "test-token" });
      let output = "";
      vi.spyOn(client, "callGenericTool").mockImplementationOnce(async (_name, args) => {
        output = String(args.export_path);
        await writeFile(output, Buffer.alloc(0));
        await truncate(output, size);
        return succeeded;
      });

      expect(await client.exportGlb({ code: "partWidth = 20" })).toEqual({
        ok: false,
        error: "CAD engine did not produce a usable GLB model",
      });
      await expectRemoved(output);
    },
  );

  it("does not call the exporter for empty input or an already aborted request", async () => {
    const client = new ZooMcpClient({ token: "test-token" });
    const call = vi.spyOn(client, "callGenericTool");
    expect(await client.exportGlb({})).toEqual({
      ok: false,
      error: "CAD export needs KCL code or a project directory",
    });
    expect(await client.exportGlb({ code: " \n " })).toEqual({
      ok: false,
      error: "CAD export needs KCL code or a project directory",
    });
    expect(await client.exportGlb({ code: "partWidth = 20", signal: AbortSignal.abort() })).toEqual(
      { ok: false, error: "CAD export cancelled" },
    );
    expect(call).not.toHaveBeenCalled();
  });

  it("discards a model produced after cancellation and cleans up", async () => {
    const client = new ZooMcpClient({ token: "test-token" });
    const controller = new AbortController();
    let output = "";
    vi.spyOn(client, "callGenericTool").mockImplementationOnce(async (_name, args, signal) => {
      expect(signal).toBe(controller.signal);
      output = String(args.export_path);
      await writeFile(output, minimalGlb());
      controller.abort();
      return succeeded;
    });

    expect(await client.exportGlb({ code: "partWidth = 20", signal: controller.signal })).toEqual({
      ok: false,
      error: "CAD export cancelled",
    });
    await expectRemoved(output);
  });

  it("handles an aborted exporter rejection without leaking temporary files", async () => {
    const client = new ZooMcpClient({ token: "test-token" });
    const controller = new AbortController();
    let output = "";
    vi.spyOn(client, "callGenericTool").mockImplementationOnce(async (_name, args) => {
      output = String(args.export_path);
      await writeFile(output, minimalGlb());
      controller.abort();
      throw new Error("Request aborted");
    });

    expect(await client.exportGlb({ code: "partWidth = 20", signal: controller.signal })).toEqual({
      ok: false,
      error: "CAD export cancelled",
    });
    await expectRemoved(output);
  });

  it("returns unexpected exporter errors as CadResult failures and cleans up", async () => {
    const client = new ZooMcpClient({ token: "test-token" });
    let output = "";
    vi.spyOn(client, "callGenericTool").mockImplementationOnce(async (_name, args) => {
      output = String(args.export_path);
      throw new Error("Connection closed");
    });

    expect(await client.exportGlb({ code: "partWidth = 20" })).toEqual({
      ok: false,
      error: "Connection closed",
    });
    await expectRemoved(output);
  });

  it("returns a temporary directory creation error as a CadResult failure", async () => {
    const client = new ZooMcpClient({ token: "test-token" });
    const call = vi.spyOn(client, "callGenericTool");
    vi.mocked(mkdtemp).mockRejectedValueOnce(new Error("Temporary storage unavailable"));
    expect(await client.exportGlb({ code: "partWidth = 20" })).toEqual({
      ok: false,
      error: "Temporary storage unavailable",
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("cleans up without dispatching if cancellation arrives during directory creation", async () => {
    const client = new ZooMcpClient({ token: "test-token" });
    const controller = new AbortController();
    const call = vi.spyOn(client, "callGenericTool");
    const original = await vi.importActual<typeof FsPromises>("node:fs/promises");
    let directory = "";
    vi.mocked(mkdtemp).mockImplementationOnce(async (...args) => {
      const created = await original.mkdtemp(...args);
      directory = String(created);
      controller.abort();
      return created;
    });
    expect(await client.exportGlb({ code: "partWidth = 20", signal: controller.signal })).toEqual({
      ok: false,
      error: "CAD export cancelled",
    });
    expect(call).not.toHaveBeenCalled();
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancels a pending connection wait without disrupting another caller sharing it", async () => {
    const client = new ZooMcpClient({ token: "test-token" });
    const controller = new AbortController();
    const connected = {
      callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "Executed" }] }),
    };
    let resolveConnection!: (value: typeof connected) => void;
    const connection = new Promise<typeof connected>((resolve) => {
      resolveConnection = resolve;
    });
    // Replace only the connection boundary; callGenericTool/callTool cancellation stays real.
    const internals = client as unknown as { ensure(): Promise<typeof connected> };
    vi.spyOn(internals, "ensure").mockReturnValue(connection);
    const close = vi.spyOn(client, "close");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");

    const cancelled = client.callGenericTool("export_kcl", {}, controller.signal);
    const otherCaller = client.callGenericTool("execute_kcl", {});
    controller.abort(new Error("Caller cancelled"));
    expect(await cancelled).toEqual({ ok: false, error: "Caller cancelled" });
    expect(connected.callTool).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));

    resolveConnection(connected);
    expect(await otherCaller).toMatchObject({ ok: true, data: { text: "Executed" } });
    expect(connected.callTool).toHaveBeenCalledTimes(1);
    expect(connected.callTool).toHaveBeenCalledWith(
      { name: "execute_kcl", arguments: {} },
      undefined,
      expect.any(Object),
    );
  });

  it("does not start a connection when a generic tool request is already cancelled", async () => {
    const client = new ZooMcpClient({ token: "test-token" });
    const internals = client as unknown as { ensure(): Promise<unknown> };
    const connect = vi.spyOn(internals, "ensure");
    expect((await client.callGenericTool("export_kcl", {}, AbortSignal.abort())).ok).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });
});
