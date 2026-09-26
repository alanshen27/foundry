import { describe, expect, it } from "vitest";
import { partialCadFiles, readAstraStream } from "../src/astra-stream";

function response(events: unknown[], fragmentSize = 7) {
  const bytes = new TextEncoder().encode(
    events
      .map(
        (e) =>
          `event: ${String((e as { type?: string }).type)}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`,
      )
      .join(""),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += fragmentSize)
          controller.enqueue(bytes.slice(i, i + fragmentSize));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("Astra live source stream", () => {
  it("decodes partial files without rendering broken JSON escapes", () => {
    expect(
      partialCadFiles('{"files":[{"path":"main.kcl","content":"width = 40\\n// \\u00'),
    ).toEqual([{ path: "main.kcl", content: "width = 40\n// " }]);
    const files = [
      { path: "main.kcl", content: 'x = "a"\n// α 😀' },
      { path: "parts/next.kcl", content: "y=20" },
    ];
    expect(partialCadFiles(JSON.stringify({ files }))).toEqual(files);
  });
  it("handles arbitrary UTF-8 and SSE frame boundaries and returns the terminal envelope", async () => {
    const terminal = { id: "resp_test", status: "completed", output: [] };
    const seen: string[] = [];
    const result = await readAstraStream(
      response(
        [
          { type: "response.created", response: { id: "resp_test" } },
          {
            type: "response.output_text.delta",
            delta: '{"files":[{"path":"main.kcl","content":"// α',
          },
          { type: "response.output_text.delta", delta: 'β"}]}' },
          { type: "response.completed", response: terminal },
        ],
        1,
      ),
      (text) => seen.push(text),
      new AbortController().signal,
    );
    expect(result).toEqual(terminal);
    expect(seen).toHaveLength(2);
    expect(partialCadFiles(seen[1]!)[0]?.content).toBe("// αβ");
  });
  it("rejects disconnected streams instead of treating partial source as complete", async () => {
    await expect(
      readAstraStream(
        response([{ type: "response.output_text.delta", delta: "partial" }]),
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow("before completion");
  });
  it("cancels a hanging response body", async () => {
    const abort = new AbortController();
    const pending = readAstraStream(
      new Response(new ReadableStream()),
      () => undefined,
      abort.signal,
    );
    abort.abort();
    await expect(pending).rejects.toThrow("cancelled");
  });
  it("surfaces explicit provider errors", async () => {
    await expect(
      readAstraStream(
        response([{ type: "error", message: "Request failed" }]),
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Request failed");
  });
});
