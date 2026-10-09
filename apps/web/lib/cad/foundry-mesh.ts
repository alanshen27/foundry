import { assemblyMeshDisplayName, parseAssemblyInstanceLabel } from "@foundry/cad";

/** v1: name + STL per solid. v2 adds a packed 0xRRGGBBAA source colour (alpha 0 = none). */
export const FOUNDRY_MESH_MAGIC = "FDRYMSH2";
const FOUNDRY_MESH_MAGIC_V1 = "FDRYMSH1";

export type FoundryMeshColor = { r: number; g: number; b: number; a: number };

export type FoundryMeshSolid = {
  name: string;
  displayName: string;
  stl: ArrayBuffer;
  componentId?: string;
  instanceId?: string;
  color?: FoundryMeshColor;
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function packColor(color: FoundryMeshColor | undefined): number {
  if (!color) return 0;
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return (
    ((channel(color.r) << 24) |
      (channel(color.g) << 16) |
      (channel(color.b) << 8) |
      channel(color.a)) >>>
    0
  );
}

function unpackColor(rgba: number): FoundryMeshColor | undefined {
  const a = rgba & 0xff;
  if (!a) return undefined;
  return { r: (rgba >>> 24) & 0xff, g: (rgba >>> 16) & 0xff, b: (rgba >>> 8) & 0xff, a };
}

export function encodeFoundryMesh(
  solids: Array<{ name: string; stl: ArrayBuffer; color?: FoundryMeshColor }>,
): ArrayBuffer {
  if (!solids.length) throw new Error("CAD model has no solid geometry");
  const names = solids.map((solid) => new TextEncoder().encode(solid.name));
  const bytes = new Uint8Array(
    12 +
      solids.reduce(
        (sum, solid, index) => sum + 10 + names[index]!.byteLength + solid.stl.byteLength,
        0,
      ),
  );
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(FOUNDRY_MESH_MAGIC), 0);
  view.setUint32(8, solids.length, true);
  let offset = 12;
  solids.forEach((solid, index) => {
    const name = names[index]!;
    view.setUint16(offset, name.byteLength, true);
    view.setUint32(offset + 2, solid.stl.byteLength, true);
    view.setUint32(offset + 6, packColor(solid.color), true);
    bytes.set(name, offset + 10);
    bytes.set(new Uint8Array(solid.stl), offset + 10 + name.byteLength);
    offset += 10 + name.byteLength + solid.stl.byteLength;
  });
  return bytes.buffer;
}

export function decodeFoundryMesh(bytes: ArrayBuffer): FoundryMeshSolid[] | null {
  if (bytes.byteLength < 12) return null;
  const magic = new TextDecoder().decode(new Uint8Array(bytes, 0, 8));
  if (magic !== FOUNDRY_MESH_MAGIC && magic !== FOUNDRY_MESH_MAGIC_V1) return null;
  const header = magic === FOUNDRY_MESH_MAGIC ? 10 : 6;
  const view = new DataView(bytes);
  const count = view.getUint32(8, true);
  assert(count > 0 && count <= 2_000, "CAD service returned an invalid labeled mesh");
  const solids: FoundryMeshSolid[] = [];
  let offset = 12;
  for (let i = 0; i < count; i += 1) {
    assert(offset + header <= bytes.byteLength, "CAD service returned an invalid labeled mesh");
    const nameLength = view.getUint16(offset, true);
    const stlLength = view.getUint32(offset + 2, true);
    const color = header === 10 ? unpackColor(view.getUint32(offset + 6, true)) : undefined;
    offset += header;
    assert(
      nameLength > 0 &&
        nameLength <= 400 &&
        stlLength >= 84 &&
        offset + nameLength + stlLength <= bytes.byteLength,
      "CAD service returned an invalid labeled mesh",
    );
    const name =
      new TextDecoder().decode(new Uint8Array(bytes, offset, nameLength)).trim() || "Body";
    offset += nameLength;
    const stl = bytes.slice(offset, offset + stlLength);
    offset += stlLength;
    const parsed = parseAssemblyInstanceLabel(name);
    solids.push({
      name,
      displayName: assemblyMeshDisplayName(name),
      stl,
      ...(parsed ? { componentId: parsed.componentId, instanceId: parsed.instanceId } : {}),
      ...(color ? { color } : {}),
    });
  }
  assert(offset === bytes.byteLength, "CAD service returned an invalid labeled mesh");
  return solids;
}
