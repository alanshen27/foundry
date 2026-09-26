/** Decode only complete JSON escapes; incomplete source is a display-only draft. */
export function partialCadFiles(json: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  const header = /\{\s*"path"\s*:\s*("(?:\\.|[^"\\])*")\s*,\s*"content"\s*:\s*"/g;
  for (const match of json.matchAll(header)) {
    let path: string;
    try {
      path = JSON.parse(match[1]!);
    } catch {
      continue;
    }
    let content = "";
    for (let i = match.index! + match[0].length; i < json.length; i += 1) {
      const c = json[i]!;
      if (c === '"') break;
      if (c !== "\\") {
        content += c;
        continue;
      }
      const escaped = json[++i];
      if (!escaped) break;
      if (escaped === "u") {
        const hex = json.slice(i + 1, i + 5);
        if (!/^[0-9a-f]{4}$/i.test(hex)) break;
        content += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else {
        const map: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          n: "\n",
          r: "\r",
          t: "\t",
          b: "\b",
          f: "\f",
        };
        if (!(escaped in map)) break;
        content += map[escaped];
      }
    }
    if (/[\uD800-\uDBFF]$/.test(content)) content = content.slice(0, -1);
    files.push({ path, content });
  }
  return files;
}

/** Responses SSE parser: token deltas for display, terminal envelope for validation. */
export async function readAstraStream(
  response: Response,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<unknown> {
  if (!response.body) throw new Error("Astra returned an empty stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let terminal: unknown;
  let streamBytes = 0;
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const process = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let event: { type?: string; delta?: unknown; response?: unknown; message?: string };
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error("Astra returned malformed streaming data");
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      output += event.delta;
      if (output.length > 4_000_000)
        throw new Error("Astra output exceeded the streaming size limit");
      onText(output);
    } else if (
      ["response.completed", "response.failed", "response.incomplete"].includes(event.type ?? "")
    ) {
      terminal = event.response;
    } else if (event.type === "error") {
      throw new Error(
        event.message ? `Astra stream error: ${event.message}` : "Astra stream failed",
      );
    }
  };
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      streamBytes += value.byteLength;
      if (streamBytes > 32_000_000) throw new Error("Astra stream exceeded its size limit");
      buffer += decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        process(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (buffer.length > 8_000_000) throw new Error("Astra stream frame exceeded its size limit");
      if (terminal) break;
    }
    if (signal.aborted) throw new Error("CAD generation cancelled");
    buffer += decoder.decode();
    if (buffer.trim()) process(buffer);
    if (!terminal) throw new Error("Astra stream ended before completion");
    return terminal;
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
