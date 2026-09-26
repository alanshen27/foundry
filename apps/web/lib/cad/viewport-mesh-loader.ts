import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { cadMeshPathSchema, cadMeshStorageKey, type CadMeshRequest } from "./mesh-request";
import { disposeCadObject } from "./three-viewport";

export type ViewportMeshUnit = "mm" | "cm" | "m" | "in" | "ft" | "yd";
export type DirectViewportMeshSource = {
  kind: "asset";
  format: "stl" | "glb";
  path: string;
  fileUrl: string;
  name: string;
  upAxis: "y" | "z";
  unit: ViewportMeshUnit;
  identity: string;
};
export type ParsedViewportMesh = {
  scene: THREE.Group;
  upAxis: "y" | "z";
  unit: ViewportMeshUnit;
  sourceIdentity?: string;
};

export const MAX_VIEWPORT_MESH_BYTES = 64 * 1024 * 1024;
const UNITS = new Set<string>(["mm", "cm", "m", "in", "ft", "yd"]);

/** Strip comments without accidentally treating quoted paths as comments. */
function uncomment(source: string): string | null {
  let result = "";
  let mode: "code" | "line" | "block" | "single" | "double" = "code";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    const next = source[i + 1];
    if (mode === "line") {
      if (char === "\n") {
        mode = "code";
        result += char;
      }
    } else if (mode === "block") {
      if (char === "/" && next === "*") return null;
      if (char === "*" && next === "/") {
        mode = "code";
        i += 1;
      } else if (char === "\n") result += char;
    } else if (mode === "single" || mode === "double") {
      result += char;
      if (char === "\\" && next !== undefined) {
        result += next;
        i += 1;
      } else if (char === (mode === "single" ? "'" : '"')) mode = "code";
    } else if (char === "/" && (next === "/" || next === "*")) {
      result += " ";
      mode = next === "/" ? "line" : "block";
      i += 1;
    } else {
      result += char;
      if (char === "'") mode = "single";
      if (char === '"') mode = "double";
    }
  }
  return mode === "code" || mode === "line" ? result : null;
}

/**
 * Only the exact standalone import wrapper can skip KCL evaluation. Any
 * transform, module, other annotation, or ambiguous source stays on the engine
 * path. Authentication still occurs on the same-origin project file route.
 */
export function directViewportMeshSource(input: CadMeshRequest): DirectViewportMeshSource | null {
  if (
    input.engine === "build123d" ||
    !input.projectId ||
    !/^[A-Za-z0-9_-]+$/.test(input.projectId) ||
    input.renderToken ||
    input.projectFiles !== undefined ||
    input.entryPath !== undefined ||
    input.script.length > 1_000_000
  )
    return null;
  const source = uncomment(input.script);
  if (!source) return null;
  const match = source.match(
    /^\s*(?:@\(\s*lengthUnit\s*=\s*(mm|cm|m|in|ft|yd)\s*\)\s*)?import[\t ]+(["'])([^"'\r\n]+)\2[\t ]+as[\t ]+([A-Za-z_][A-Za-z0-9_]*)[\t ]*\r?\n\s*\4\s*$/,
  );
  if (!match) return null;
  const [, annotation, , path, name] = match;
  if (!path || !name || !cadMeshPathSchema.safeParse(path).success) return null;
  // These cannot be an identifier expression in the canonical wrapper.
  if (/^(?:import|export|as|from|fn|return|if|else|for|while|true|false)$/.test(name)) return null;
  const extension = path.match(/\.(stl|glb)$/i)?.[1]?.toLowerCase();
  if (extension !== "stl" && extension !== "glb") return null;
  const matches = input.meshAssets?.filter((asset) => asset.path === path) ?? [];
  if (matches.length !== 1) return null;
  const asset = matches[0]!;
  if (
    asset.format.toLowerCase() !== extension ||
    !cadMeshStorageKey(asset.fileUrl, input.projectId) ||
    (asset.lengthUnit !== undefined && !UNITS.has(asset.lengthUnit))
  )
    return null;
  // glTF carries its own meters/Y-up convention. Other import annotations may
  // change engine semantics, so they must be evaluated by the engine instead.
  if (extension === "glb" && annotation) return null;
  const unit: ViewportMeshUnit =
    extension === "glb"
      ? "m"
      : ((annotation as ViewportMeshUnit | undefined) ?? asset.lengthUnit ?? "mm");
  const upAxis = extension === "glb" ? "y" : "z";
  return {
    kind: "asset",
    format: extension,
    path,
    fileUrl: asset.fileUrl,
    name,
    upAxis,
    unit,
    identity: JSON.stringify({
      projectId: input.projectId,
      path,
      fileUrl: asset.fileUrl,
      format: extension,
      unit,
      upAxis,
    }),
  };
}

/** Bound streamed bodies as well as responses with a Content-Length header. */
async function readMeshBytes(response: Response): Promise<ArrayBuffer> {
  if (Number(response.headers.get("Content-Length")) > MAX_VIEWPORT_MESH_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("CAD mesh exceeds the preview size limit");
  }
  const reader = response.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_VIEWPORT_MESH_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("CAD mesh exceeds the preview size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

/** Reject resource references before the glTF parser can initiate any loads. */
function assertSelfContainedGlb(bytes: ArrayBuffer): void {
  if (bytes.byteLength < 20) throw new Error("CAD service returned an invalid GLB model");
  const view = new DataView(bytes);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength
  )
    throw new Error("CAD service returned an invalid GLB model");
  let offset = 12;
  let sawJson = false;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error("CAD GLB model is truncated");
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (length % 4 !== 0 || offset + 8 + length > bytes.byteLength)
      throw new Error("CAD GLB model is truncated");
    if (offset === 12 && type !== 0x4e4f534a) throw new Error("CAD GLB model has no metadata");
    if (type === 0x4e4f534a) {
      if (sawJson) throw new Error("CAD GLB model contains duplicate metadata");
      sawJson = true;
      let metadata: unknown;
      try {
        metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, offset + 8, length)));
      } catch {
        throw new Error("CAD GLB model has invalid metadata");
      }
      // Iterative traversal also avoids stack overflows for deeply nested input.
      const queue: unknown[] = [metadata];
      while (queue.length) {
        const node = queue.pop();
        if (!node || typeof node !== "object") continue;
        for (const [key, value] of Object.entries(node)) {
          if (key === "uri" && (typeof value !== "string" || !value.startsWith("data:")))
            throw new Error("CAD mesh referenced an external resource");
          if (value && typeof value === "object") queue.push(value);
        }
      }
    }
    offset += 8 + length;
  }
  if (!sawJson) throw new Error("CAD GLB model has no metadata");
}

function parseStl(bytes: ArrayBuffer, name: string): THREE.Group {
  if (bytes.byteLength < 84) throw new Error("CAD service returned an invalid STL model");
  const view = new DataView(bytes);
  const binaryLength = 84 + view.getUint32(80, true) * 50;
  if (binaryLength !== bytes.byteLength) {
    const text = new TextDecoder().decode(bytes);
    if (!/^\s*solid(?:\s|$)/i.test(text) || !/endsolid[^\r\n]*\s*$/i.test(text))
      throw new Error("CAD service returned an invalid STL model");
  }
  let geometry: THREE.BufferGeometry & { hasColors?: boolean; alpha?: number };
  try {
    geometry = new STLLoader().parse(bytes);
  } catch {
    throw new Error("CAD service returned an invalid STL model");
  }
  const alpha = geometry.hasColors ? (geometry.alpha ?? 1) : 1;
  const material = new THREE.MeshStandardMaterial({
    color: geometry.hasColors ? 0xffffff : 0xb8bab7,
    vertexColors: Boolean(geometry.hasColors),
    metalness: 0.15,
    roughness: 0.65,
    opacity: alpha,
    transparent: alpha < 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  const scene = new THREE.Group();
  scene.add(mesh);
  return scene;
}

function assertRenderable(scene: THREE.Group): void {
  let meshes = 0;
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute("position");
    if (!positions || positions.count < 3) throw new Error("CAD model has no solid geometry");
    for (let i = 0; i < positions.count; i += 1) {
      if (
        !Number.isFinite(positions.getX(i)) ||
        !Number.isFinite(positions.getY(i)) ||
        !Number.isFinite(positions.getZ(i))
      )
        throw new Error("CAD model contains invalid geometry");
    }
    meshes += 1;
  });
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  if (!meshes || bounds.isEmpty()) throw new Error("CAD model has no solid geometry");
  if (![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite))
    throw new Error("CAD model contains invalid geometry");
}

/**
 * Parse an authenticated response without fetching outside the supplied bytes.
 * The caller owns successful scenes and must dispose them after their last use.
 */
export async function parseViewportMeshResponse(
  response: Response,
  source?: DirectViewportMeshSource,
): Promise<ParsedViewportMesh> {
  const bytes = await readMeshBytes(response);
  if (!response.ok) {
    let detail: { error?: unknown } | null = null;
    try {
      detail = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      // Proxies may return HTML instead of the application's JSON error.
    }
    throw new Error(
      typeof detail?.error === "string" ? detail.error : `CAD export failed (${response.status})`,
    );
  }
  const upAxis = source?.upAxis ?? response.headers.get("X-Cad-Up-Axis") ?? "y";
  const unit = source?.unit ?? response.headers.get("X-Cad-Unit") ?? "m";
  if ((upAxis !== "y" && upAxis !== "z") || !UNITS.has(unit))
    throw new Error("Unsupported CAD mesh coordinate system");
  let scene: THREE.Group | null = null;
  try {
    const contentType = response.headers
      .get("Content-Type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (source?.format === "stl" || (!source && contentType === "model/stl")) {
      scene = parseStl(bytes, source?.name ?? "Python model");
    } else {
      assertSelfContainedGlb(bytes);
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {
        // Blob URLs here are created internally for embedded image bufferViews;
        // the metadata check above rejects pre-existing blob references.
        if (url.startsWith("blob:") || url.startsWith("data:")) return url;
        throw new Error("CAD mesh referenced an external resource");
      });
      scene = (await new GLTFLoader(manager).parseAsync(bytes, "")).scene;
    }
    assertRenderable(scene);
    return {
      scene,
      upAxis,
      unit: unit as ViewportMeshUnit,
      ...(source ? { sourceIdentity: source.identity } : {}),
    };
  } catch (error) {
    if (scene) disposeCadObject(scene);
    throw error;
  }
}
