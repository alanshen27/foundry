import * as THREE from "three";

/** Synthetic exploded recorder. This is UI sample geometry, never engineering evidence. */
export function recorderFixtureMesh(part?: string): Uint8Array<ArrayBuffer> {
  const definitions: Array<{
    id: string;
    name: string;
    geometry: THREE.BufferGeometry;
    color: number;
    metal?: number;
  }> = [];
  const add = (
    id: string,
    name: string,
    geometry: THREE.BufferGeometry,
    color: number,
    metal = 0.25,
  ) => definitions.push({ id, name, geometry, color, metal });
  const cylinder = (radius: number, height: number, z: number) =>
    new THREE.CylinderGeometry(radius, radius, height, 64).rotateX(Math.PI / 2).translate(0, 0, z);
  const ring = (outer: number, inner: number, height: number, z: number) => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    return new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: true,
      bevelThickness: 0.3,
      bevelSize: 0.3,
      bevelSegments: 2,
      curveSegments: 48,
      steps: 1,
    }).translate(0, 0, z);
  };
  add("base", "Lower housing", cylinder(32, 1.5, 0), 0xc3c0b7, 0.6);
  add("base", "Housing rim", ring(32, 29.8, 5, 0), 0xc3c0b7, 0.6);
  add("magnet", "MagSafe mounting ring", ring(26, 22, 1.5, -5), 0x414341, 0.65);
  add("battery", "Battery pack", new THREE.BoxGeometry(32, 23, 4).translate(0, -3, 10), 0x444947);
  add("board", "Main PCB", cylinder(27.5, 1.4, 18), 0x326754, 0.1);
  add(
    "board",
    "Audio controller",
    new THREE.BoxGeometry(9, 9, 1.8).translate(-7, -3, 20),
    0x292d2c,
  );
  add(
    "board",
    "Storage module",
    new THREE.BoxGeometry(12, 8, 1.5).translate(8, 4, 20),
    0x9b9c97,
    0.7,
  );
  add(
    "board",
    "USB-C socket",
    new THREE.BoxGeometry(9, 6, 3.3).translate(0, -25, 20),
    0xb7b8b3,
    0.8,
  );
  for (const x of [-14, 14]) {
    add("board", "MEMS microphone", cylinder(2.2, 1.5, 20).translate(x, 14, 0), 0xb1a783, 0.7);
  }
  add("top", "Upper housing", cylinder(32, 2.5, 32), 0xcac7bf, 0.5);
  add("button", "Record button", cylinder(7, 1.7, 34.1), 0xe66a35, 0.15);
  add(
    "diffuser",
    "Status light",
    new THREE.BoxGeometry(12, 1.3, 0.6).translate(0, -14, 33.6),
    0xa4c8b5,
    0.05,
  );
  for (let i = 0; i < 7; i++) {
    add(
      "top",
      "Microphone grille",
      cylinder(0.7, 0.4, 33.4).translate(-9 + i * 3, 17, 0),
      0x4a4d48,
      0.1,
    );
  }

  const selected = definitions.filter((entry) => !part || entry.id === part);
  const chunks: Uint8Array[] = [];
  const views: object[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];
  const materials: object[] = [];
  let byteOffset = 0;
  const append = (
    array: Float32Array,
    count: number,
    bounds?: { min: number[]; max: number[] },
  ) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    chunks.push(bytes);
    views.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target: 34962 });
    byteOffset += bytes.byteLength;
    accessors.push({
      bufferView: views.length - 1,
      componentType: 5126,
      count,
      type: "VEC3",
      ...bounds,
    });
    return accessors.length - 1;
  };
  for (const entry of selected) {
    const geometry = entry.geometry.index ? entry.geometry.toNonIndexed() : entry.geometry;
    geometry.computeBoundingBox();
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const positionIndex = append(position.array as Float32Array, position.count, {
      min: geometry.boundingBox!.min.toArray(),
      max: geometry.boundingBox!.max.toArray(),
    });
    const normalIndex = append(normal.array as Float32Array, normal.count);
    const color = new THREE.Color(entry.color);
    materials.push({
      pbrMetallicRoughness: {
        baseColorFactor: [...color.toArray(), 1],
        metallicFactor: entry.metal,
        roughnessFactor: 0.45,
      },
    });
    meshes.push({
      name: entry.name,
      primitives: [
        {
          attributes: { POSITION: positionIndex, NORMAL: normalIndex },
          material: materials.length - 1,
        },
      ],
    });
    if (geometry !== entry.geometry) geometry.dispose();
  }
  definitions.forEach((entry) => entry.geometry.dispose());
  const gltf = {
    asset: { version: "2.0", generator: "Foundry LOCAL / UNVERIFIED UI fixture" },
    scene: 0,
    scenes: [{ nodes: selected.map((_, index) => index) }],
    nodes: selected.map((entry, index) => ({
      mesh: index,
      name: entry.name,
      extras: { assemblyComponentId: entry.id, name: entry.name },
    })),
    meshes,
    materials,
    buffers: [{ byteLength: byteOffset }],
    bufferViews: views,
    accessors,
  };
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(28 + jsonLength + byteOffset);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, bytes.length, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonLength);
  bytes.set(json, 20);
  header.setUint32(20 + jsonLength, byteOffset, true);
  header.setUint32(24 + jsonLength, 0x004e4942, true);
  let offset = 28 + jsonLength;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
