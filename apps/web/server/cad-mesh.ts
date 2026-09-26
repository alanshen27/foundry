import "server-only";
import { createHash } from "node:crypto";
import { cadMeshStorageKey, type CadMeshRequest } from "@/lib/cad/mesh-request";
import { getObjectStorage } from "./storage";
import { runPythonCad } from "@foundry/cad/server";

type CadModel = Extract<Awaited<ReturnType<typeof runPythonCad>>, { ok: true }>["data"];

const cache = new Map<string, { model: CadModel; expiresAt: number }>();
type PendingMesh = {
  controller: AbortController;
  promise: Promise<CadModel>;
  viewers: number;
};
const pending = new Map<string, PendingMesh>();
const CACHE_BYTES = 50_000_000;
const CACHE_TTL_MS = 5 * 60_000;

/** A closing view must not cancel an export another view is still waiting for. */
function waitForMesh(job: PendingMesh, signal: AbortSignal): Promise<CadModel> {
  job.viewers += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      job.viewers -= 1;
      complete();
    };
    const aborted = () => {
      finish(() => reject(signal.reason));
      if (job.viewers === 0) job.controller.abort(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    job.promise.then(
      (glb) => finish(() => resolve(glb)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (signal.aborted) aborted();
  });
}

/** Cache only successful immutable input snapshots; authorization precedes this call. */
export async function compileCadModel(
  input: CadMeshRequest,
  projectId: string | undefined,
  signal: AbortSignal,
): Promise<CadModel> {
  signal.throwIfAborted();
  if (input.engine !== "build123d")
    throw new Error("Zoo is disabled. Convert KCL to Python/build123d before building.");
  const files = { ...input.projectFiles, [input.entryPath ?? "main.py"]: input.script };
  const assets = [...(input.meshAssets ?? [])].sort((a, b) => a.path.localeCompare(b.path));
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        projectId,
        engine: "build123d",
        entryPath: input.entryPath ?? "main.py",
        files: Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
        assets,
      }),
    )
    .digest("hex");
  for (const [id, value] of cache) if (value.expiresAt <= Date.now()) cache.delete(id);
  const cached = cache.get(key);
  if (cached) {
    // Keep frequently viewed models when the bounded cache needs room.
    cache.delete(key);
    cache.set(key, cached);
    return cached.model;
  }
  const existing = pending.get(key);
  if (existing && !existing.controller.signal.aborted) return waitForMesh(existing, signal);

  const controller = new AbortController();
  const job: PendingMesh = {
    controller,
    viewers: 0,
    promise: buildModel(files, input.entryPath ?? "main.py", assets, projectId, controller.signal)
      .then((model) => {
        controller.signal.throwIfAborted();
        // A large exact export should not evict every useful interactive preview.
        if (modelBytes(model) > CACHE_BYTES) return model;
        let used = [...cache.values()].reduce((size, entry) => size + modelBytes(entry.model), 0);
        for (const [id, entry] of cache) {
          if (used + modelBytes(model) <= CACHE_BYTES && cache.size < 32) break;
          cache.delete(id);
          used -= modelBytes(entry.model);
        }
        if (modelBytes(model) <= CACHE_BYTES)
          cache.set(key, { model, expiresAt: Date.now() + CACHE_TTL_MS });
        return model;
      })
      .finally(() => {
        // An abandoned build may finish after a newer attempt has started.
        if (pending.get(key) === job) pending.delete(key);
      }),
  };
  pending.set(key, job);
  return waitForMesh(job, signal);
}

function modelBytes(model: CadModel): number {
  return model.stl.byteLength + model.step.byteLength;
}

export async function exportCadMesh(
  input: CadMeshRequest,
  projectId: string | undefined,
  signal: AbortSignal,
): Promise<Buffer> {
  return (await compileCadModel(input, projectId, signal)).stl;
}

async function buildModel(
  files: Record<string, string>,
  entryPath: string,
  assets: NonNullable<CadMeshRequest["meshAssets"]>,
  projectId: string | undefined,
  signal: AbortSignal,
): Promise<CadModel> {
  const bytes: Record<string, Uint8Array> = {};
  let assetBytes = 0;
  for (const asset of assets) {
    signal.throwIfAborted();
    const storageKey = projectId ? cadMeshStorageKey(asset.fileUrl, projectId) : null;
    if (!storageKey) throw new Error("Mesh asset does not belong to this project");
    const stored = await getObjectStorage().get(storageKey);
    if (!stored) throw new Error("Mesh asset is unavailable");
    assetBytes += stored.body.byteLength;
    if (assetBytes > 50_000_000) throw new Error("Mesh assets exceed the preview limit");
    bytes[asset.path] = stored.body;
  }
  signal.throwIfAborted();
  const result = await runPythonCad({
    files,
    entryPath,
    assets: bytes,
    signal,
    timeoutMs: 120_000,
  });
  if (!result.ok) throw new Error(result.error);
  signal.throwIfAborted();
  return result.data;
}
