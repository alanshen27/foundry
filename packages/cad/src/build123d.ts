import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, dirname, resolve, sep } from "node:path";
import { z } from "zod";
import type { CadResult, CadBoundingBox } from "./port";
import { isPythonProjectPath } from "./python-project";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_LOG_BYTES = 128_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const BUILD123D_VERSION = "0.9.1";
/** Last ocpsvg that imports on cadquery-ocp 7.8; 0.7.0 requires OCP.collections from 7.9. */
const OCPSVG_VERSION = "0.5.0";
const PYTHON_VERSION = "3.12";
export const PYTHON_CAD_PACKAGES = [
  `build123d==${BUILD123D_VERSION}`,
  `ocpsvg==${OCPSVG_VERSION}`,
] as const;

export type Build123dRunOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Trusted runtime resolver only; generated code never executes uv. */
  uvCommand?: string;
  /** Stream progress notes emitted by the Python script. */
  onProgress?: (note: string) => void;
};
export type PythonCadInput = Build123dRunOptions & {
  files: Record<string, string>;
  entryPath: string;
  /** Already-authorized, project-relative CAD resources supplied by the storage boundary. */
  assets?: Record<string, Uint8Array>;
};
export type PythonCadOutput = {
  stl: Buffer;
  /** Exact OCCT source shape exported directly to STEP, never reconstructed from STL. */
  step: Buffer;
  bbox: CadBoundingBox;
  valid: boolean;
  solidCount: number;
  volumeMm3: number;
  logs: string;
};
export type Build123dRunOutput = Omit<PythonCadOutput, "bbox"> & {
  bbox: { x: number; y: number; z: number };
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

const vectorSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});
const metadataSchema = z.object({
  bbox: z.object({ center: vectorSchema, dimensions: vectorSchema }),
  valid: z.literal(true),
  solidCount: z.number().int().positive(),
  volumeMm3: z.number().finite().positive(),
});
const runtimeSchema = z.object({
  executable: z.string(),
  roots: z.array(z.string()).min(1),
  sites: z.array(z.string()),
});
type Runtime = z.infer<typeof runtimeSchema>;
const runtimes = new Map<string, Runtime>();

// This trusted probe resolves only pinned dependencies. It receives no generated source.
const PROBE = `import sys,json,os
sites = [os.path.realpath(p) for p in sys.path if "site-packages" in p and not p.startswith(sys.prefix + os.sep)]
roots = {os.path.realpath(sys.base_prefix), *sites}
print(json.dumps({"executable":os.path.realpath(sys.executable),"roots":sorted(roots),"sites":sites}))`;

// The driver sets process/file limits before importing any project code. The OS sandbox,
// not Python imports or uv's virtual environment, enforces filesystem and network isolation.
const DRIVER = `import json, sys, os, runpy, resource, math, struct
resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
resource.setrlimit(resource.RLIMIT_FSIZE, (${MAX_FILE_BYTES}, ${MAX_FILE_BYTES}))
resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
sys.path.extend(json.loads(sys.argv[2]))
project = os.path.join(os.getcwd(), "project")
sys.path.insert(0, project)
os.chdir(project)
print("BUILD123D_PROGRESS: loading build123d", flush=True)
from build123d import Shape, Builder, Color, export_stl, export_step
print("BUILD123D_PROGRESS: executing model", flush=True)
module = runpy.run_module(sys.argv[1][:-3].replace("/", "."), run_name="__main__")
shape = module.get("result")
if isinstance(shape, Builder):
    shape = getattr(shape, "part", getattr(shape, "_obj", None))
if shape is None:
    raise ValueError("BUILD123D_ERROR: the script must assign the finished model to a variable named 'result'")
if not isinstance(shape, Shape):
    raise ValueError("BUILD123D_ERROR: 'result' must be a build123d Shape or BuildPart")
if not shape.is_valid:
    raise ValueError("BUILD123D_ERROR: OCCT reports invalid geometry; repair the source before export")
solids = shape.solids()
volume = sum(s.volume for s in solids)
if not solids or not math.isfinite(volume) or volume <= 0:
    raise ValueError("BUILD123D_ERROR: result must contain nonempty solid geometry, not a mesh, wire, or empty compound")
print("BUILD123D_PROGRESS: computing bounding box", flush=True)
bb = shape.bounding_box()
size, center = bb.size, bb.center()
if not all(math.isfinite(v) for v in [size.X,size.Y,size.Z,center.X,center.Y,center.Z]):
    raise ValueError("BUILD123D_ERROR: result has nonfinite bounds")
output = os.path.join(os.path.dirname(project), "output")
print("BUILD123D_PROGRESS: exporting mesh", flush=True)

def shape_label(item, fallback=""):
    label = getattr(item, "label", None)
    if isinstance(label, str):
        label = " ".join(label.split())
    return label or fallback

def shape_rgba(item, inherited=0):
    value = getattr(item, "color", None)
    if value is None:
        return inherited
    try:
        if not isinstance(value, Color):
            value = Color(*value) if isinstance(value, (tuple, list)) else Color(value)
            item.color = value
        r, g, b, a = value.to_tuple()
    except Exception:
        try:
            item.color = None
        except Exception:
            pass
        return inherited
    channels = [max(0, min(255, round(float(v) * 255))) for v in (r, g, b, a)]
    if not all(math.isfinite(v) for v in channels) or channels[3] == 0:
        return inherited
    return (channels[0] << 24) | (channels[1] << 16) | (channels[2] << 8) | channels[3]

def labeled_solids(item, inherited="", inherited_rgba=0):
    name = shape_label(item)
    rgba = shape_rgba(item, inherited_rgba)
    if inherited.startswith("foundry:") and name and name != inherited:
        combined = inherited + "|" + name
    else:
        combined = name or inherited
    children = list(getattr(item, "children", None) or [])
    if children:
        found = []
        for child in children:
            found.extend(labeled_solids(child, combined, rgba))
        if found:
            return found
    item_solids = item.solids() if hasattr(item, "solids") else []
    if not item_solids:
        return []
    if len(item_solids) == 1:
        return [(combined or "Body", item_solids[0], shape_rgba(item_solids[0], rgba))]
    prefix = combined or "Body"
    return [(f"{prefix} {i+1}", solid, shape_rgba(solid, rgba)) for i, solid in enumerate(item_solids)]

def sanitize_label(label):
    cleaned = "".join(ch if 32 <= ord(ch) <= 126 else " " for ch in str(label))
    return " ".join(cleaned.split())[:200] or "Body"

packed = []
for raw_label, solid, rgba in labeled_solids(shape):
    tmp = os.path.join(output, f"_solid_{len(packed)}.stl")
    if not export_stl(solid, tmp, tolerance=0.05, angular_tolerance=0.1):
        raise ValueError("BUILD123D_ERROR: STL export failed")
    with open(tmp, "rb") as fh:
        packed.append((sanitize_label(raw_label), fh.read(), rgba))
    os.remove(tmp)
if not packed:
    raise ValueError("BUILD123D_ERROR: result must contain nonempty solid geometry, not a mesh, wire, or empty compound")
chunks = [b"FDRYMSH2" + struct.pack("<I", len(packed))]
for name, data, rgba in packed:
    encoded = name.encode("utf-8")
    chunks.append(struct.pack("<HII", len(encoded), len(data), rgba))
    chunks.append(encoded)
    chunks.append(data)
with open(os.path.join(output, "model.stl"), "wb") as f:
    f.write(b"".join(chunks))
if not export_step(shape, os.path.join(output, "model.step")):
    raise ValueError("BUILD123D_ERROR: STEP export failed")
with open(os.path.join(output, "meta.json"), "w") as f:
    json.dump({"bbox":{"center":{"x":center.X,"y":center.Y,"z":center.Z},"dimensions":{"x":size.X,"y":size.Y,"z":size.Z}},"valid":True,"solidCount":len(solids),"volumeMm3":volume},f)
`;

type ProcessResult = {
  code: number | null;
  output: string;
  cancelled: boolean;
  timedOut: boolean;
  exceeded: boolean;
};
async function boundedProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    timeoutMs: number;
    monitorMemory?: boolean;
    onProgress?: (note: string) => void;
  },
): Promise<ProcessResult> {
  if (options.signal?.aborted)
    return { code: null, output: "", cancelled: true, timedOut: false, exceeded: false };
  return new Promise((resolveResult, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    let bytes = 0;
    let cancelled = false;
    let timedOut = false;
    let exceeded = false;
    let memoryBusy = false;
    const sink = createOutputSink(options.onProgress);
    const kill = () => {
      try {
        if (proc.pid) process.kill(-proc.pid, "SIGKILL");
      } catch {
        proc.kill("SIGKILL");
      }
    };
    const collect = (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_LOG_BYTES) {
        exceeded = true;
        kill();
        return;
      }
      const text = chunk.toString();
      output += text;
      sink.append(text);
    };
    proc.stdout.on("data", collect);
    proc.stderr.on("data", collect);
    const onAbort = () => {
      cancelled = true;
      kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    // macOS does not enforce RLIMIT_RSS. Bound resident memory with a sampled host
    // watchdog instead; the sandbox denies child processes so this is the whole build.
    const memoryTimer = options.monitorMemory
      ? setInterval(() => {
          if (!proc.pid || memoryBusy) return;
          memoryBusy = true;
          const ps = spawn("/bin/ps", ["-o", "rss=", "-p", String(proc.pid)], {
            env: { PATH: "/usr/bin:/bin", NODE_ENV: "production" },
            stdio: ["ignore", "pipe", "ignore"],
          });
          let rss = "";
          ps.stdout.on("data", (data: Buffer) => {
            rss += data.toString().slice(0, 100);
          });
          ps.once("error", () => {
            memoryBusy = false;
          });
          ps.once("close", () => {
            memoryBusy = false;
            if (Number(rss.trim()) > 2 * 1024 * 1024) {
              exceeded = true;
              kill();
            }
          });
        }, 1000)
      : undefined;
    const cleanup = () => {
      clearTimeout(timer);
      if (memoryTimer) clearInterval(memoryTimer);
      options.signal?.removeEventListener("abort", onAbort);
      sink.flush();
    };
    proc.once("error", (error) => {
      cleanup();
      reject(error);
    });
    proc.once("close", (code) => {
      cleanup();
      resolveResult({ code, output, cancelled, timedOut, exceeded });
    });
  });
}

function cleanEnvironment(home: string, temporary: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: home,
    TMPDIR: temporary,
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    OPENBLAS_NUM_THREADS: "1",
    OMP_NUM_THREADS: "1",
    MKL_NUM_THREADS: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUNBUFFERED: "1",
  };
}

async function resolveRuntime(
  uvCommand: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Runtime> {
  const cached = runtimes.get(uvCommand);
  if (cached) return cached;
  const env = cleanEnvironment(homedir(), tmpdir());
  env.PATH = process.env.PATH ?? env.PATH;
  const result = await boundedProcess(
    uvCommand,
    [
      "run",
      "--no-project",
      "--python",
      PYTHON_VERSION,
      ...PYTHON_CAD_PACKAGES.flatMap((pkg) => ["--with", pkg]),
      "python",
      "-I",
      "-c",
      PROBE,
    ],
    { cwd: tmpdir(), env, signal, timeoutMs },
  );
  if (result.cancelled) throw new Error("build123d run cancelled");
  if (result.timedOut) throw new Error("build123d runtime setup timed out");
  if (result.code !== 0 || result.exceeded)
    throw new Error(`build123d runtime setup failed: ${summarizePythonError(result.output)}`);
  const line = result.output
    .split("\n")
    .reverse()
    .find((item) => item.startsWith('{"executable":'));
  const runtime = runtimeSchema.parse(JSON.parse(line ?? "null"));
  runtimes.set(uvCommand, runtime);
  return runtime;
}

function sandboxProfile(runtime: Runtime, dir: string): string {
  const q = (path: string) => JSON.stringify(path);
  const roots = [
    ...runtime.roots,
    "/System/Library",
    "/usr/lib",
    "/usr/share",
    "/Library/Apple/System/Library",
    dir,
  ];
  return `(version 1)\n(deny default)\n(allow process-exec (literal ${q(runtime.executable)}))\n(allow signal (target self))\n(allow sysctl-read)\n(allow file-read-metadata)\n(allow file-read* ${roots.map((path) => `(subpath ${q(path)})`).join(" ")} (literal "/") (literal "/dev/urandom") (literal "/dev/random") (literal "/dev/null"))\n(allow file-write* (subpath ${q(dir)}) (literal "/dev/null"))\n`;
}

async function readOutput(path: string, maxBytes = MAX_FILE_BYTES): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maxBytes)
    throw new Error("build123d produced an invalid or oversized output file");
  return readFile(path);
}

/** Execute untrusted native source. macOS sandbox is mandatory; unsupported hosts fail closed. */
export async function runPythonCad(input: PythonCadInput): Promise<CadResult<PythonCadOutput>> {
  if (input.signal?.aborted) return { ok: false, error: "build123d run cancelled" };
  let dir: string | undefined;
  try {
    if (process.platform !== "darwin")
      throw new Error(
        "Native Python CAD needs a configured OS sandbox. This runner currently supports macOS sandbox-exec; use a restricted container worker on other hosts.",
      );
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 240_000)
      throw new Error("Python CAD timeoutMs must be between 1 and 240000");
    const entries = Object.entries(input.files);
    if (!entries.length || entries.length > 100 || !Object.hasOwn(input.files, input.entryPath))
      throw new Error("Python CAD requires an entry file and at most 100 source files");
    let bytes = 0;
    for (const [path, source] of entries) {
      if (
        !isPythonProjectPath(path) ||
        typeof source !== "string" ||
        source.includes("\0") ||
        source.length > 1_000_000
      )
        throw new Error(`Invalid Python CAD source: ${path}`);
      bytes += Buffer.byteLength(source);
    }
    if (bytes > 4_000_000) throw new Error("Python CAD source project exceeds 4 MB");
    const assets = Object.entries(input.assets ?? {});
    if (assets.length > 100) throw new Error("Python CAD supports at most 100 asset files");
    for (const [path, data] of assets) {
      if (
        !/^(?:[A-Za-z0-9_][A-Za-z0-9_. -]*\/)*[A-Za-z0-9_][A-Za-z0-9_. -]*\.(step|stp|ste|stl|brep)$/i.test(
          path,
        ) ||
        path.split("/").some((p) => p === "." || p === "..") ||
        !(data instanceof Uint8Array)
      )
        throw new Error(`Invalid Python CAD asset: ${path}`);
      bytes += data.byteLength;
      if (data.byteLength > MAX_FILE_BYTES || bytes > 128 * 1024 * 1024)
        throw new Error("Python CAD assets exceed the size limit");
    }
    const started = Date.now();
    const runtime = await resolveRuntime(input.uvCommand ?? "uv", input.signal, timeoutMs);
    if (input.signal?.aborted) throw new Error("build123d run cancelled");
    dir = await realpath(await mkdtemp(join(tmpdir(), "foundry-b123d-")));
    const project = join(dir, "project");
    await Promise.all([
      mkdir(project),
      mkdir(join(dir, "output")),
      mkdir(join(dir, "home")),
      mkdir(join(dir, "tmp")),
    ]);
    for (const [path, content] of [...entries, ...assets] as [string, string | Uint8Array][]) {
      const target = resolve(project, path);
      if (!target.startsWith(project + sep)) throw new Error("Python CAD path escapes its project");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, { flag: "wx" });
    }
    await writeFile(join(dir, "driver.py"), DRIVER);
    const remainingMs = timeoutMs - (Date.now() - started);
    if (remainingMs <= 0) throw new Error("build123d runtime setup exceeded the run timeout");
    const outcome = await boundedProcess(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        sandboxProfile(runtime, dir),
        runtime.executable,
        "-I",
        "-B",
        join(dir, "driver.py"),
        input.entryPath,
        JSON.stringify(runtime.sites),
      ],
      {
        cwd: dir,
        env: cleanEnvironment(join(dir, "home"), join(dir, "tmp")),
        signal: input.signal,
        timeoutMs: remainingMs,
        monitorMemory: true,
        onProgress: input.onProgress,
      },
    );
    if (outcome.cancelled) throw new Error("build123d run cancelled");
    if (outcome.timedOut)
      throw new Error(`build123d run exceeded ${Math.round(timeoutMs / 1000)}s`);
    if (outcome.exceeded)
      throw new Error("build123d exceeded its memory or diagnostic output limit");
    if (outcome.code !== 0) throw new Error(summarizePythonError(outcome.output));
    const [stl, step, metadata] = await Promise.all([
      readOutput(join(dir, "output/model.stl")),
      readOutput(join(dir, "output/model.step")),
      readOutput(join(dir, "output/meta.json"), 16_384),
    ]);
    const meta = metadataSchema.parse(JSON.parse(metadata.toString("utf8")));
    if (!step.subarray(0, 100).toString("ascii").includes("ISO-10303-21"))
      throw new Error("build123d exported an invalid STEP header");
    return { ok: true, data: { stl, step, ...meta, logs: outcome.output.trim() } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Compatibility wrapper; native source still runs inside the mandatory OS sandbox. */
export async function runBuild123d(
  script: string,
  options: Build123dRunOptions = {},
): Promise<CadResult<Build123dRunOutput>> {
  const result = await runPythonCad({
    files: { "main.py": script },
    entryPath: "main.py",
    ...options,
  });
  return result.ok
    ? { ok: true, data: { ...result.data, bbox: result.data.bbox.dimensions } }
    : result;
}

/** Return an actionable Python error rather than dependency resolver chatter. */
export function summarizePythonError(logs: string): string {
  const marker = logs.lastIndexOf("BUILD123D_ERROR:");
  if (marker !== -1)
    return logs
      .slice(marker + "BUILD123D_ERROR:".length)
      .trim()
      .split("\n")[0]!
      .trim();
  const lines = logs.split("\n").filter((line) => line.trim());
  const tbStart = lines.findIndex((line) => line.startsWith("Traceback"));
  if (tbStart !== -1) {
    const tail = lines.slice(tbStart);
    const last = tail.at(-1) ?? "";
    const source = tail
      .slice(0, -1)
      .reverse()
      .find((line) => line.startsWith("    ") && !line.trimStart().startsWith("File "));
    return source ? `${last} — at: ${source.trim()}` : last;
  }
  return lines.slice(-4).join("\n") || "build123d run failed with no output";
}
