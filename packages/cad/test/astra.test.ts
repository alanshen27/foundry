import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAstraCadAdapter } from "../src/astra";

const geometry = vi.hoisted(() => ({
  executeKcl: vi.fn(),
  boundingBoxKcl: vi.fn(),
  multiviewSnapshotKcl: vi.fn(),
  exportGlb: vi.fn(),
}));
vi.mock("../src/mcp", () => ({ ZooMcpClient: vi.fn(() => geometry) }));

const fetchMock = vi.fn<typeof fetch>();
const kcl = "partWidth = 40\n";
const adapter = () => createAstraCadAdapter({ apiKey: "openai-key", token: "zoo-token" });

function envelope(files = [{ path: "main.kcl", content: kcl }]) {
  return {
    id: "resp_astra_1",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify({ files }) }],
      },
    ],
  };
}

function respond(payload: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status }));
}

function requestBody() {
  return JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
}

function hangUntilAborted() {
  fetchMock.mockImplementationOnce(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
      }),
  );
}

describe("Astra CAD generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses GPT-6 Astra Responses with strict structured output and separate credentials", async () => {
    respond(envelope());
    const onProgress = vi.fn();

    const result = await adapter().textToCad("A mounting bracket", {
      projectName: "Bracket",
      onProgress,
    });

    expect(result).toEqual({ ok: true, data: { kcl, id: "resp_astra_1" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer openai-key", "content-type": "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
    const body = requestBody();
    expect(body.model).toBe("gpt-6-astra");
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      strict: true,
      schema: { additionalProperties: false },
    });
    expect(body.instructions).toContain("exactly main.kcl");
    expect(body.instructions).toContain("millimetres");
    expect(body.instructions).toContain("Do not shadow KCL built-ins");
    expect(body.instructions).toContain("Custom-function arguments require labels");
    expect(body.instructions).toContain("offset(cx = 0, cy = 0), never offset(0, 0)");
    expect(JSON.stringify(body)).not.toContain("zoo-token");
    expect(JSON.parse(body.input[0].content)).toMatchObject({
      prompt: "A mounting bracket",
      projectName: "Bracket",
      operation: "generate",
    });
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.stringContaining("requires execution and verification"),
    );
  });

  it("honors an explicitly configured CAD model", async () => {
    respond(envelope());
    await createAstraCadAdapter({
      apiKey: "key",
      token: "token",
      model: "gpt-6-astra-pinned",
    }).textToCad("Bracket");
    expect(requestBody().model).toBe("gpt-6-astra-pinned");
  });

  it("emits source while the Responses stream is open and saves only the completed result", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            stream = controller;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    const onDraft = vi.fn();
    const pending = adapter().textToCad("Bracket", { onDraft });
    const emit = (event: unknown) =>
      stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    emit({
      type: "response.output_text.delta",
      delta: '{"files":[{"path":"main.kcl","content":"partWidth = ',
    });
    await vi.waitFor(() =>
      expect(onDraft).toHaveBeenCalledWith({ path: "main.kcl", content: "partWidth = " }),
    );
    emit({ type: "response.completed", response: envelope() });
    stream.close();
    expect(await pending).toEqual({ ok: true, data: { kcl, id: "resp_astra_1" } });
    expect(requestBody().stream).toBe(true);
  });

  it("keeps all generated project files and dependencies", async () => {
    const files = [
      { path: "main.kcl", content: 'import "parts/bracket/main.kcl" as bracket\nbracket\n' },
      { path: "parts/bracket/main.kcl", content: kcl },
    ];
    respond(envelope(files));
    expect(await adapter().textToCadProject("Bracket assembly")).toEqual({
      ok: true,
      data: {
        files: Object.fromEntries(files.map((file) => [file.path, file.content])),
        id: "resp_astra_1",
      },
    });
  });

  it("passes existing single-file KCL to an iteration", async () => {
    respond(envelope());
    expect((await adapter().iterateCad("partWidth = 30\n", "Make it 40 mm wide")).ok).toBe(true);
    expect(JSON.parse(requestBody().input[0].content)).toMatchObject({
      operation: "iterate",
      currentFiles: { "main.kcl": "partWidth = 30\n" },
    });
  });

  it("requires project iteration when the source imports unavailable dependencies", async () => {
    const result = await adapter().iterateCad(
      'import "parts/main.kcl" as part\npart\n',
      "Resize it",
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("iterateCadProject"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a project that omits an imported KCL dependency", async () => {
    respond(
      envelope([
        { path: "main.kcl", content: 'import "parts/missing/main.kcl" as missing\nmissing\n' },
      ]),
    );
    expect(await adapter().textToCadProject("Bracket")).toMatchObject({
      ok: false,
      error: expect.stringContaining("unresolved KCL import"),
    });
  });

  it("accepts imports resolved relative to a generated module", async () => {
    respond(
      envelope([
        { path: "main.kcl", content: 'import "parts/main.kcl" as part\npart\n' },
        { path: "parts/main.kcl", content: 'import "./helper.kcl" as helper\nhelper\n' },
        { path: "parts/helper.kcl", content: kcl },
      ]),
    );
    expect((await adapter().textToCadProject("Bracket")).ok).toBe(true);
  });

  it("merges project edits without discarding unchanged or empty files", async () => {
    respond(envelope([{ path: "assembly/product.kcl", content: "assemblyWidth = 80\n" }]));
    const files = {
      "assembly/product.kcl": "assemblyWidth = 70\n",
      "parts/a/main.kcl": kcl,
      "empty.kcl": "",
    };
    const result = await adapter().iterateCadProject(files, "Widen the preview", {
      focusPath: "assembly/product.kcl",
    });
    expect(result).toEqual({
      ok: true,
      data: {
        files: { ...files, "assembly/product.kcl": "assemblyWidth = 80\n" },
        id: "resp_astra_1",
      },
    });
    expect(JSON.parse(requestBody().input[0].content).focusPath).toBe("assembly/product.kcl");
    expect(files["assembly/product.kcl"]).toBe("assemblyWidth = 70\n");
  });

  it("rejects edits or new files outside the focused assembly file", async () => {
    respond(envelope([{ path: "parts/a/main.kcl", content: "partWidth = 99\n" }]));
    const result = await adapter().iterateCadProject(
      { "assembly/product.kcl": kcl, "parts/a/main.kcl": kcl },
      "Assemble",
      { focusPath: "assembly/product.kcl" },
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("read-only reference"),
    });
    respond(envelope([{ path: "parts/new/main.kcl", content: kcl }]));
    expect(
      (
        await adapter().iterateCadProject({ "main.kcl": kcl }, "Assemble", {
          focusPath: "assembly/product.kcl",
        })
      ).ok,
    ).toBe(false);
  });

  it("accepts unchanged reference files returned alongside the focused edit", async () => {
    respond(
      envelope([
        { path: "assembly/product.kcl", content: "assemblyWidth = 80\n" },
        { path: "parts/a/main.kcl", content: kcl },
      ]),
    );
    const result = await adapter().iterateCadProject(
      { "assembly/product.kcl": kcl, "parts/a/main.kcl": kcl },
      "Assemble",
      { focusPath: "assembly/product.kcl" },
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    "../escape.kcl",
    "/absolute.kcl",
    "parts/../../escape.kcl",
    "C:\\escape.kcl",
    "parts\\escape.kcl",
    "parts/./escape.kcl",
    "main.py",
    "main.kcl\0",
  ])("rejects untrusted output path %s", async (path) => {
    respond(envelope([{ path, content: kcl }]));
    expect(await adapter().textToCadProject("Bracket")).toMatchObject({
      ok: false,
      error: expect.stringContaining("invalid KCL"),
    });
  });

  it.each([
    { files: [] },
    { files: [{ path: "main.kcl", content: "  " }] },
    { files: [{ path: "main.kcl", content: "bad\0source" }] },
    { files: [{ path: "main.kcl", content: "```kcl\npartWidth = 40\n```" }] },
    {
      files: [
        { path: "main.kcl", content: kcl },
        { path: "main.kcl", content: "duplicate" },
      ],
    },
    { files: [{ path: "other.kcl", content: kcl }] },
  ])("rejects empty, duplicate, or incomplete generated projects", async ({ files }) => {
    respond(envelope(files));
    expect((await adapter().textToCadProject("Bracket")).ok).toBe(false);
  });

  it("rejects a multi-file response through the single-file interface", async () => {
    respond(
      envelope([
        { path: "main.kcl", content: kcl },
        { path: "dependency.kcl", content: kcl },
      ]),
    );
    expect(await adapter().textToCad("Bracket")).toMatchObject({
      ok: false,
      error: expect.stringContaining("exactly main.kcl"),
    });
  });

  it.each(['import "dependency.kcl" as part\n', 'export import "dependency.kcl"\n'])(
    "rejects single-file output with unresolved imports",
    async (content) => {
      respond(envelope([{ path: "main.kcl", content }]));
      expect(await adapter().textToCad("Bracket")).toMatchObject({
        ok: false,
        error: expect.stringContaining("imports"),
      });
    },
  );

  it("reports API errors and never falls back to Zoo generation", async () => {
    respond({ error: { message: "Model access denied" } }, 403);
    expect(await adapter().textToCad("Bracket")).toEqual({
      ok: false,
      error: "Astra API error (HTTP 403): Model access denied",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(geometry.executeKcl).not.toHaveBeenCalled();
  });

  it.each(["failed", "incomplete", "cancelled", "queued", "in_progress"])(
    "rejects response status %s even when it contains KCL",
    async (status) => {
      respond({ ...envelope(), status, incomplete_details: { reason: "max_output_tokens" } });
      expect(await adapter().textToCad("Bracket")).toMatchObject({
        ok: false,
        error: expect.stringContaining(status),
      });
    },
  );

  it("surfaces refusals without accepting their output", async () => {
    respond({
      id: "resp_refusal",
      status: "completed",
      output: [
        { type: "message", content: [{ type: "refusal", refusal: "Cannot produce that design" }] },
      ],
    });
    expect(await adapter().textToCad("Bracket")).toEqual({
      ok: false,
      error: "Astra declined CAD generation: Cannot produce that design",
    });
  });

  it.each([
    { status: "completed", output: [] },
    { ...envelope(), id: undefined },
    { ...envelope(), status: undefined },
    {
      ...envelope(),
      output: [{ type: "message", content: [{ type: "output_text", text: "not JSON" }] }],
    },
    {
      ...envelope(),
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({ files: [{ path: "main.kcl", content: kcl, extra: true }] }),
            },
          ],
        },
      ],
    },
  ])("rejects malformed or missing structured responses", async (payload) => {
    respond(payload);
    expect((await adapter().textToCad("Bracket")).ok).toBe(false);
  });

  it("rejects all legacy operation resumes before creating a request", async () => {
    const options = { existingOpId: "zoo_old_id" };
    const cad = adapter();
    const results = await Promise.all([
      cad.textToCad("Bracket", options),
      cad.textToCadProject("Bracket", options),
      cad.iterateCad(kcl, "Bracket", options),
      cad.iterateCadProject({ "main.kcl": kcl }, "Bracket", options),
    ]);
    expect(results.every((result) => !result.ok && result.error.includes("cannot resume"))).toBe(
      true,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates empty prompts, sources, focus paths, and timeout values before requests", async () => {
    const cad = adapter();
    const results = await Promise.all([
      cad.textToCad(" "),
      cad.iterateCad(" ", "Bracket"),
      cad.iterateCadProject({}, "Bracket"),
      cad.iterateCadProject({ "../source.kcl": kcl }, "Bracket"),
      cad.iterateCadProject({ "main.kcl": kcl }, "Bracket", { focusPath: "../outside.kcl" }),
      cad.textToCad("Bracket", { timeoutMs: -1 }),
    ]);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels without submitting when the caller signal is already aborted", async () => {
    expect(await adapter().textToCad("Bracket", { signal: AbortSignal.abort() })).toEqual({
      ok: false,
      error: "CAD generation cancelled",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an in-flight request when cancelled and clears its timers", async () => {
    vi.useFakeTimers();
    hangUntilAborted();
    const controller = new AbortController();
    const pending = adapter().textToCad("Bracket", { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: "CAD generation cancelled" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("enforces the caller timeout without claiming resumability", async () => {
    vi.useFakeTimers();
    hangUntilAborted();
    const pending = adapter().textToCad("Bracket", { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining("timed out") });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps progress active during a long request and stops it after cancellation", async () => {
    vi.useFakeTimers();
    hangUntilAborted();
    const controller = new AbortController();
    const onProgress = vi.fn();
    const pending = adapter().textToCad("Bracket", { onProgress, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onProgress).toHaveBeenLastCalledWith("Astra is still generating KCL.");
    controller.abort();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves geometry operations without an OpenAI credential", async () => {
    const cad = createAstraCadAdapter({ token: "zoo-token" });
    geometry.executeKcl.mockResolvedValue({ ok: true, data: { message: "Executed" } });
    geometry.boundingBoxKcl.mockResolvedValue({
      ok: true,
      data: { dimensions: { x: 1, y: 2, z: 3 } },
    });
    geometry.multiviewSnapshotKcl.mockResolvedValue({
      ok: true,
      data: { jpeg: Buffer.from("jpeg") },
    });
    geometry.exportGlb.mockResolvedValue({ ok: true, data: { glb: Buffer.from("glb") } });
    const input = { code: kcl };
    expect((await cad.executeKcl(input)).ok).toBe(true);
    expect((await cad.boundingBoxKcl(input)).ok).toBe(true);
    expect((await cad.multiviewSnapshotKcl(input)).ok).toBe(true);
    expect((await cad.exportGlb(input)).ok).toBe(true);
    for (const operation of Object.values(geometry)) expect(operation).toHaveBeenCalledWith(input);
    expect(await cad.textToCad("Bracket")).toEqual({
      ok: false,
      error: "Astra CAD generation requires OPENAI_API_KEY",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
