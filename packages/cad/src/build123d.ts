import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CadResult } from "./port";

/**
 * build123d (OCCT) code-CAD runner: executes a Python script in an isolated
 * `uv run` environment and returns the exported STL mesh. This is the fast,
 * LLM-friendly path — plain Python, local execution, no ML agent loop.
 *
 * Script contract: the script must end up with the model in a variable named
 * `result` (a build123d Shape/Part/Compound or a BuildPart builder). The
 * runner appends the export; the script itself never touches the filesystem.
 */

/** First run pays the uv resolve + OCCT wheel download; later runs are seconds. */
const DEFAULT_TIMEOUT_MS = 240_000;

const BUILD123D_VERSION = "0.9.1";
const PYTHON_VERSION = "3.12";

export type Build123dRunOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Override the uv binary (tests). */
  uvCommand?: string;
  /** Stream progress notes emitted by the Python script. */
  onProgress?: (note: string) => void;
};

export type Build123dRunOutput = {
  stl: Buffer;
  /** Bounding box of the exported shape, millimetres. */
  bbox: { x: number; y: number; z: number };
  logs: string;
};

const PROGRESS_PREFIX = "BUILD123D_PROGRESS:";

export function extractProgressNote(line: string): string | null {
  const idx = line.indexOf(PROGRESS_PREFIX);
  if (idx === -1) return null;
  const note = line.slice(idx + PROGRESS_PREFIX.length).trim();
  return note || null;
}

function createOutputSink(onProgress?: (note: string) => void): {
  append: (chunk: string) => void;
  flush: () => void;
  raw: string;
} {
  let buffer = "";
  let raw = "";

  const processBuffer = () => {
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl === -1) break;
      const line = buffer.slice(0, nl).trimEnd();
      buffer = buffer.slice(nl + 1);
      const note = extractProgressNote(line);
      if (note) onProgress?.(note);
    }
  };

  return {
    append(chunk) {
      raw += chunk;
      buffer += chunk;
      processBuffer();
    },
    flush() {
      const line = buffer.trimEnd();
      if (line) {
        const note = extractProgressNote(line);
        if (note) onProgress?.(note);
      }
      buffer = "";
    },
    get raw() {
      return raw;
    },
  };
}

const DRIVER = `
import json, sys

print("BUILD123D_PROGRESS: loading build123d")
from build123d import Shape, export_stl
try:
    from build123d import Builder
except ImportError:
    Builder = None

print("BUILD123D_PROGRESS: executing model")
import model  # user script; must define \`result\`

shape = getattr(model, "result", None)
if Builder is not None and isinstance(shape, Builder):
    shape = shape.part if hasattr(shape, "part") else getattr(shape, "_obj", None)
if shape is None:
    print("BUILD123D_ERROR: the script must assign the finished model to a variable named 'result'", file=sys.stderr)
    sys.exit(3)
if not isinstance(shape, Shape):
    print(f"BUILD123D_ERROR: 'result' is {type(shape).__name__}, not a build123d Shape/Part", file=sys.stderr)
    sys.exit(3)

print("BUILD123D_PROGRESS: computing bounding box")
bb = shape.bounding_box()
print("BUILD123D_PROGRESS: exporting mesh")
export_stl(shape, "out.stl")
with open("meta.json", "w") as f:
    json.dump({"bbox": {"x": bb.size.X, "y": bb.size.Y, "z": bb.size.Z}}, f)
`;

export async function runBuild123d(
  script: string,
  opts: Build123dRunOptions = {},
): Promise<CadResult<Build123dRunOutput>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dir = await mkdtemp(join(tmpdir(), "foundry-b123d-"));
  try {
    await writeFile(join(dir, "model.py"), script, "utf8");
    await writeFile(join(dir, "driver.py"), DRIVER, "utf8");

    const proc = spawn(
      opts.uvCommand ?? "uv",
      [
        "run",
        "--no-project",
        "--python",
        PYTHON_VERSION,
        "--with",
        `build123d==${BUILD123D_VERSION}`,
        "driver.py",
      ],
      {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      },
    );

    const outSink = createOutputSink(opts.onProgress);
    const errSink = createOutputSink(opts.onProgress);
    proc.stdout.on("data", (d: Buffer) => outSink.append(d.toString("utf8")));
    proc.stderr.on("data", (d: Buffer) => errSink.append(d.toString("utf8")));

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve(null);
      }, timeoutMs);
      const onAbort = () => {
        proc.kill("SIGKILL");
        resolve(null);
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        resolve(code);
      });
    }).catch((err: Error) => {
      errSink.append(`\nspawn failed: ${err.message}`);
      return 1;
    });

    outSink.flush();
    errSink.flush();
    const out = outSink.raw;
    const errOut = errSink.raw;
    const logs = [out.trim(), errOut.trim()].filter(Boolean).join("\n");
    if (exitCode === null) {
      return {
        ok: false,
        error: opts.signal?.aborted
          ? "build123d run cancelled"
          : `build123d run exceeded ${Math.round(timeoutMs / 1000)}s`,
      };
    }
    if (exitCode !== 0) {
      return { ok: false, error: summarizePythonError(logs) };
    }

    const [stl, metaRaw] = await Promise.all([
      readFile(join(dir, "out.stl")),
      readFile(join(dir, "meta.json"), "utf8"),
    ]);
    const meta = JSON.parse(metaRaw) as { bbox: { x: number; y: number; z: number } };
    if (stl.byteLength === 0) return { ok: false, error: "build123d exported an empty STL" };
    return { ok: true, data: { stl, bbox: meta.bbox, logs } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Return the part of a Python traceback the model can act on, not pip noise. */
export function summarizePythonError(logs: string): string {
  const marker = logs.lastIndexOf("BUILD123D_ERROR:");
  if (marker !== -1) {
    return logs
      .slice(marker + "BUILD123D_ERROR:".length)
      .trim()
      .split("\n")[0]!
      .trim();
  }
  const lines = logs.split("\n").filter((l) => l.trim());
  const tbStart = lines.findIndex((l) => l.startsWith("Traceback"));
  if (tbStart !== -1) {
    const tail = lines.slice(tbStart);
    // Last line is the exception; include the offending source line when shown.
    const last = tail[tail.length - 1] ?? "";
    const srcLine = tail
      .slice(0, -1)
      .reverse()
      .find((l) => l.startsWith("    ") && !l.trimStart().startsWith("File "));
    return srcLine ? `${last} — at: ${srcLine.trim()}` : last;
  }
  const tail = lines.slice(-4).join("\n");
  return tail || "build123d run failed with no output";
}
