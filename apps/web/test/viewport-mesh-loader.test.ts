import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { CadMeshRequest } from "@/lib/cad/mesh-request";
import {
  directViewportMeshSource,
  MAX_VIEWPORT_MESH_BYTES,
  parseViewportMeshResponse,
} from "@/lib/cad/viewport-mesh-loader";
import { disposeCadObject } from "@/lib/cad/three-viewport";
import { decodeFoundryMesh, encodeFoundryMesh } from "@/lib/cad/foundry-mesh";

function request(overrides: Partial<CadMeshRequest> = {}): CadMeshRequest {
  return {
    projectId: "project-1",
    script:
      '// UNVERIFIED imported mesh\n@(lengthUnit = mm)\nimport "imports/base.stl" as base\nbase\n',
    meshAssets: [
      {
        path: "imports/base.stl",
        format: "stl",
        fileUrl: "/api/files/projects/project-1/cad/imports/base.stl",
      },
    ],
    ...overrides,
  };
}

function triangleStl(): ArrayBuffer {
  const bytes = new ArrayBuffer(134);
  const view = new DataView(bytes);
  view.setUint32(80, 1, true);
  // Normal, then a 20 x 10 mm triangle on the XY plane.
  [0, 0, 1, 0, 0, 0, 20, 0, 0, 0, 10, 0].forEach((value, i) =>
    view.setFloat32(84 + i * 4, value, true),
  );
  return bytes;
}

function glb(json: Record<string, unknown>, binary?: Uint8Array): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = binary ? Math.ceil(binary.length / 4) * 4 : 0;
  const bytes = new ArrayBuffer(12 + 8 + jsonLength + (binary ? 8 + binLength : 0));
  const view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  const content = new Uint8Array(bytes, 20, jsonLength);
  content.fill(32);
  content.set(text);
  if (binary) {
    const offset = 20 + jsonLength;
    view.setUint32(offset, binLength, true);
    view.setUint32(offset + 4, 0x004e4942, true);
    new Uint8Array(bytes, offset + 8).set(binary);
  }
  return bytes;
}

function triangleGlb(): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 0.02, 0, 0, 0, 0.01, 0]);
  return glb(
    {
      asset: { version: "2.0" },
      buffers: [{ byteLength: positions.byteLength }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [0.02, 0.01, 0],
        },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    },
    new Uint8Array(positions.buffer),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("direct viewport import eligibility", () => {
  it("never treats Python source as a legacy import wrapper", () => {
    expect(directViewportMeshSource(request({ engine: "build123d" }))).toBeNull();
  });
  it("recognizes the canonical imported STL without depending on the CAD engine", () => {
    expect(directViewportMeshSource(request())).toMatchObject({
      kind: "asset",
      format: "stl",
      path: "imports/base.stl",
      name: "base",
      fileUrl: "/api/files/projects/project-1/cad/imports/base.stl",
      upAxis: "z",
      unit: "mm",
    });
  });

  it("honors inline unit annotations ahead of stored asset units and defaults to mm", () => {
    const input = request();
    input.meshAssets![0]!.lengthUnit = "in";
    input.script =
      "/* imported */ @(lengthUnit = cm) import 'imports/base.stl' as base // base\nbase";
    expect(directViewportMeshSource(input)?.unit).toBe("cm");
    input.script = 'import "imports/base.stl" as base\nbase';
    expect(directViewportMeshSource(input)?.unit).toBe("in");
    delete input.meshAssets![0]!.lengthUnit;
    expect(directViewportMeshSource(input)?.unit).toBe("mm");
  });

  it.each([
    '@(foo = 10)\nimport "imports/base.stl" as base\nbase',
    '@(lengthUnit = cm, angleUnit = deg)\nimport "imports/base.stl" as base\nbase',
    '@(lengthUnit = mm)\n@(lengthUnit = cm)\nimport "imports/base.stl" as base\nbase',
    'import "imports/base.stl" as base\nbase |> translate(x = 4)',
    'import "imports/base.stl" as base\nbase\nother = 10',
    'import "imports/base.stl" as base\nbase\nimport "parts/lid/main.kcl" as lid',
    'import "imports/base.stl" as base\nbase\nbase',
    'import "imports/base.stl" as base\nother',
    'import "imports/base.stl" as base base',
    '// import "imports/base.stl" as base\n// base',
    'import "imports/base.stl" as base\nbase\n/* never closed',
    'import "imports/base.stl" as base\nbase\n/* nested /* comment */',
    'import "imports/../base.stl" as base\nbase',
  ])("keeps non-canonical or modified scripts on the engine path: %s", (script) => {
    expect(directViewportMeshSource(request({ script }))).toBeNull();
  });

  it("requires a unique matching asset within the current project's authenticated route", () => {
    for (const fileUrl of [
      "/api/files/projects/project-2/cad/base.stl",
      "/api/files/projects/project-10/cad/base.stl",
      "/api/files/projects/project-1/../project-2/base.stl",
      "/api/files/projects/project-1/cad/%2e%2e/base.stl",
      "/api/files/projects/project-1/cad/base.stl?redirect=1",
      "https://example.com/base.stl",
    ]) {
      const input = request();
      input.meshAssets![0]!.fileUrl = fileUrl;
      expect(directViewportMeshSource(input)).toBeNull();
    }
    expect(directViewportMeshSource(request({ meshAssets: [] }))).toBeNull();
    const duplicate = request();
    duplicate.meshAssets!.push({ ...duplicate.meshAssets![0]! });
    expect(directViewportMeshSource(duplicate)).toBeNull();
    const wrongFormat = request();
    wrongFormat.meshAssets![0]!.format = "step";
    expect(directViewportMeshSource(wrongFormat)).toBeNull();
  });

  it("leaves render-token sessions, multi-file projects, and STEP conversion on the engine path", () => {
    expect(directViewportMeshSource(request({ renderToken: "signed-token" }))).toBeNull();
    expect(directViewportMeshSource(request({ projectFiles: {} }))).toBeNull();
    expect(directViewportMeshSource(request({ entryPath: "main.kcl" }))).toBeNull();
    expect(directViewportMeshSource(request({ projectId: undefined }))).toBeNull();
    const step = request();
    step.script = 'import "imports/base.step" as base\nbase';
    step.meshAssets![0] = { ...step.meshAssets![0]!, path: "imports/base.step", format: "step" };
    expect(directViewportMeshSource(step)).toBeNull();
  });

  it("treats a standalone GLB as meters/Y-up and rejects GLB unit overrides", () => {
    const input = request({
      script: 'import "imports/base.glb" as base\nbase',
      meshAssets: [
        {
          path: "imports/base.glb",
          format: "glb",
          fileUrl: "/api/files/projects/project-1/cad/base.glb",
        },
      ],
    });
    expect(directViewportMeshSource(input)).toMatchObject({
      format: "glb",
      unit: "m",
      upAxis: "y",
    });
    input.script = `@(lengthUnit = cm)\n${input.script}`;
    expect(directViewportMeshSource(input)).toBeNull();
  });
});

describe("viewport mesh response parsing", () => {
  it("parses actual STL geometry in its source units without any network access", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Unexpected network access");
    });
    vi.stubGlobal("fetch", fetch);
    const source = directViewportMeshSource(request())!;
    const result = await parseViewportMeshResponse(new Response(triangleStl()), source);
    expect(result).toMatchObject({ upAxis: "z", unit: "mm", sourceIdentity: source.identity });
    expect(
      new THREE.Box3().setFromObject(result.scene).getSize(new THREE.Vector3()).toArray(),
    ).toEqual([20, 10, 0]);
    expect(fetch).not.toHaveBeenCalled();
    disposeCadObject(result.scene);
  });

  it("supports ASCII STL and keeps an explicit imperial source unit", async () => {
    const source = directViewportMeshSource(
      request({
        script: '@(lengthUnit = in) import "imports/base.stl" as base\nbase',
      }),
    )!;
    const ascii =
      "solid base\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid base\n";
    const result = await parseViewportMeshResponse(new Response(ascii), source);
    expect(result.unit).toBe("in");
    expect(new THREE.Box3().setFromObject(result.scene).max.x).toBe(1);
    disposeCadObject(result.scene);
  });

  it("splits a labeled assembly mesh so each instance can be highlighted", async () => {
    const packed = encodeFoundryMesh([
      { name: "foundry:base:instance-base:Lower housing", stl: triangleStl() },
      { name: "foundry:pcb-1:instance-pcb:Main board|U1", stl: triangleStl() },
    ]);
    const result = await parseViewportMeshResponse(
      new Response(packed, {
        headers: {
          "Content-Type": "model/stl",
          "X-Cad-Up-Axis": "z",
          "X-Cad-Unit": "mm",
        },
      }),
    );
    const meshes = result.scene.children.filter((child) => child instanceof THREE.Mesh);
    expect(meshes.map((mesh) => mesh.name)).toEqual(["Lower housing", "U1 · Main board"]);
    expect(meshes.map((mesh) => mesh.userData.assemblyComponentId)).toEqual(["base", "pcb-1"]);
    disposeCadObject(result.scene);
  });

  it("renders build123d source colours per solid and keeps uncoloured solids neutral", async () => {
    const packed = encodeFoundryMesh([
      { name: "Lens", stl: triangleStl(), color: { r: 20, g: 40, b: 160, a: 128 } },
      { name: "Button", stl: triangleStl(), color: { r: 255, g: 90, b: 0, a: 255 } },
      { name: "Shell", stl: triangleStl() },
    ]);
    const result = await parseViewportMeshResponse(
      new Response(packed, {
        headers: { "Content-Type": "model/stl", "X-Cad-Up-Axis": "z", "X-Cad-Unit": "mm" },
      }),
    );
    const [lens, button, shell] = result.scene.children as THREE.Mesh[];
    const material = (mesh: THREE.Mesh) => mesh.material as THREE.MeshStandardMaterial;
    expect(lens!.userData.cadSourceColor).toBe("#1428a0");
    expect(material(lens!).transparent).toBe(true);
    expect(material(lens!).opacity).toBeCloseTo(128 / 255);
    expect(`#${material(button!).color.getHexString(THREE.SRGBColorSpace)}`).toBe("#ff5a00");
    expect(material(button!).transparent).toBe(false);
    expect(shell!.userData.cadSourceColor).toBeUndefined();
    expect(material(shell!).color.getHex()).toBe(0xb8bab7);
    disposeCadObject(result.scene);
  });

  it("still decodes version-1 labeled meshes without colour", () => {
    const stl = triangleStl();
    const name = new TextEncoder().encode("Body");
    const bytes = new Uint8Array(12 + 6 + name.byteLength + stl.byteLength);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode("FDRYMSH1"), 0);
    view.setUint32(8, 1, true);
    view.setUint16(12, name.byteLength, true);
    view.setUint32(14, stl.byteLength, true);
    bytes.set(name, 18);
    bytes.set(new Uint8Array(stl), 18 + name.byteLength);
    const solids = decodeFoundryMesh(bytes.buffer)!;
    expect(solids).toHaveLength(1);
    expect(solids[0]).toMatchObject({ name: "Body" });
    expect(solids[0]!.color).toBeUndefined();
  });

  it("parses native Python STL responses using the server's units and axis", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Unexpected network access");
    });
    vi.stubGlobal("fetch", fetch);
    const result = await parseViewportMeshResponse(
      new Response(triangleStl(), {
        headers: {
          "Content-Type": "model/stl; charset=binary",
          "X-Cad-Up-Axis": "z",
          "X-Cad-Unit": "mm",
        },
      }),
    );
    expect(result).toMatchObject({ upAxis: "z", unit: "mm" });
    expect(
      new THREE.Box3().setFromObject(result.scene).getSize(new THREE.Vector3()).toArray(),
    ).toEqual([20, 10, 0]);
    expect(fetch).not.toHaveBeenCalled();
    disposeCadObject(result.scene);
  });

  it("parses embedded GLB geometry and validates server coordinate headers", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Unexpected network access");
    });
    vi.stubGlobal("fetch", fetch);
    const result = await parseViewportMeshResponse(
      new Response(triangleGlb(), {
        headers: { "X-Cad-Up-Axis": "z", "X-Cad-Unit": "mm" },
      }),
    );
    expect(result).toMatchObject({ upAxis: "z", unit: "mm" });
    expect(result.scene.children).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    disposeCadObject(result.scene);
    await expect(
      parseViewportMeshResponse(
        new Response(triangleGlb(), {
          headers: { "X-Cad-Up-Axis": "x" },
        }),
      ),
    ).rejects.toThrow("coordinate system");
    await expect(
      parseViewportMeshResponse(
        new Response(triangleGlb(), {
          headers: { "X-Cad-Unit": "feet" },
        }),
      ),
    ).rejects.toThrow("coordinate system");
  });

  it.each(["https://example.com/mesh.bin", "/private.bin", "../mesh.bin", "blob:previous-upload"])(
    "rejects GLB resource references before they can fetch: %s",
    async (uri) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(
        parseViewportMeshResponse(
          new Response(
            glb({
              asset: { version: "2.0" },
              buffers: [{ uri, byteLength: 100 }],
            }),
          ),
        ),
      ).rejects.toThrow("external resource");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("surfaces authorization errors and malformed or empty geometry without substitutes", async () => {
    await expect(
      parseViewportMeshResponse(Response.json({ error: "Sign in to preview" }, { status: 401 })),
    ).rejects.toThrow("Sign in to preview");
    await expect(parseViewportMeshResponse(new Response(null, { status: 403 }))).rejects.toThrow(
      "403",
    );
    await expect(parseViewportMeshResponse(new Response("not a mesh"))).rejects.toThrow(
      "invalid GLB",
    );
    await expect(
      parseViewportMeshResponse(
        new Response(glb({ asset: { version: "2.0" }, scenes: [{ nodes: [] }], scene: 0 })),
      ),
    ).rejects.toThrow("no solid geometry");
    const source = directViewportMeshSource(request())!;
    await expect(parseViewportMeshResponse(new Response("not a mesh"), source)).rejects.toThrow(
      "invalid STL",
    );
    const nonfinite = triangleStl();
    new DataView(nonfinite).setFloat32(96, Number.NaN, true);
    await expect(parseViewportMeshResponse(new Response(nonfinite), source)).rejects.toThrow(
      "invalid geometry",
    );
  });

  it("rejects truncated GLB chunks and oversized responses", async () => {
    const broken = triangleGlb();
    new DataView(broken).setUint32(12, broken.byteLength, true);
    await expect(parseViewportMeshResponse(new Response(broken))).rejects.toThrow("truncated");
    await expect(
      parseViewportMeshResponse(
        new Response("model", {
          headers: { "Content-Length": String(MAX_VIEWPORT_MESH_BYTES + 1) },
        }),
      ),
    ).rejects.toThrow("size limit");
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_VIEWPORT_MESH_BYTES));
          controller.enqueue(new Uint8Array(1));
        },
        cancel,
      }),
    );
    await expect(parseViewportMeshResponse(response)).rejects.toThrow("size limit");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
