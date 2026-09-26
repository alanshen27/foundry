import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPythonCadAdapter } from "../src/python-astra";
const fetchMock = vi.fn<typeof fetch>();
const source = "from build123d import Box\nresult = Box(10,20,5)\n";
const path = "parts/bracket/main.py";
function envelope(files = [{ path, content: source }]) {
  return {
    id: "resp_python_1",
    status: "completed",
    output: [
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ files }) }] },
    ],
  };
}
function respond(payload: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status }));
}
const adapter = () => createPythonCadAdapter({ apiKey: "test-openai-key" });
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("native Python Astra adapter", () => {
  it("uses only Astra Responses and streams native source with explicit kernel contract", async () => {
    respond(envelope());
    const result = await adapter().generate("A bracket", { focusPath: path });
    expect(result).toEqual({ ok: true, data: { files: { [path]: source }, id: "resp_python_1" } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ model: "gpt-6-astra", store: false, stream: true });
    expect(body.instructions).toContain("build123d 0.9.1");
    expect(body.instructions).toContain("No network, subprocesses");
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true });
    expect(JSON.stringify(body)).not.toContain("ZOO_API_TOKEN");
  });
  it("preserves all omitted references and rejects edits outside a focused part", async () => {
    const other = "parts/lid/main.py";
    const files = { [path]: source, [other]: source };
    respond(envelope([{ path, content: source.replace("10", "15") }]));
    const result = await adapter().generate("Widen bracket", { files, focusPath: path });
    expect(result.ok && result.data.files[other]).toBe(source);
    respond(envelope([{ path: other, content: "result = None" }]));
    const rejected = await adapter().generate("Widen bracket", { files, focusPath: path });
    expect(rejected).toMatchObject({ ok: false, error: expect.stringContaining("read-only") });
  });
  it.each(["../escape.py", "parts/a-b/main.py", "main.kcl", "/tmp/main.py"])(
    "rejects invalid native path %s",
    async (invalid) => {
      respond(envelope([{ path: invalid, content: source }]));
      expect(await adapter().generate("Bracket")).toMatchObject({
        ok: false,
        error: expect.stringContaining("invalid Python files"),
      });
    },
  );
  it("rejects duplicate files and missing project imports", async () => {
    respond(
      envelope([
        { path, content: source },
        { path, content: source },
      ]),
    );
    expect(await adapter().generate("Bracket")).toMatchObject({
      ok: false,
      error: expect.stringContaining("duplicate"),
    });
    respond(envelope([{ path, content: "from parts.absent.main import result\n" }]));
    expect(await adapter().generate("Bracket")).toMatchObject({
      ok: false,
      error: expect.stringContaining("Missing imported Python module"),
    });
  });
  it("streams display-only drafts before terminal completion", async () => {
    const text = JSON.stringify({ files: [{ path, content: source }] });
    const events = [
      { type: "response.output_text.delta", delta: text.slice(0, -5) },
      { type: "response.output_text.delta", delta: text.slice(-5) },
      { type: "response.completed", response: envelope() },
    ];
    const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    fetchMock.mockResolvedValueOnce(
      new Response(body, { headers: { "content-type": "text/event-stream" } }),
    );
    const drafts = vi.fn();
    const result = await adapter().generate("Bracket", { onDraft: drafts });
    expect(result.ok).toBe(true);
    expect(
      drafts.mock.calls.some(([file]) => file.path === path && file.content.length < source.length),
    ).toBe(true);
    expect(drafts).toHaveBeenLastCalledWith({ path, content: source });
  });
  it("does not accept disconnected streams as completed source", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    expect(await adapter().generate("Bracket")).toMatchObject({ ok: false });
  });
  it("supports preflight cancellation and cancellation during a streamed response", async () => {
    const stopped = new AbortController();
    stopped.abort();
    expect(await adapter().generate("Bracket", { signal: stopped.signal })).toMatchObject({
      ok: false,
      error: expect.stringContaining("cancelled"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init!.signal!.addEventListener("abort", () => reject(new Error("Aborted"))),
        ),
    );
    const controller = new AbortController();
    const pending = adapter().generate("Bracket", { signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining("cancelled") });
  });
  it("bounds generation timeout and returns actionable provider failure", async () => {
    expect(await adapter().generate("Bracket", { timeoutMs: 0 })).toMatchObject({ ok: false });
    respond({ error: { message: "Quota exceeded" } }, 429);
    expect(await adapter().generate("Bracket")).toMatchObject({
      ok: false,
      error: expect.stringContaining("Quota exceeded"),
    });
  });
});
