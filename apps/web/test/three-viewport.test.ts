import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  applyCadHighlight,
  assemblyComponentId,
  CAD_HIGHLIGHT_COLOR,
  cadModelTransform,
  cadPickableMeshes,
  cadSelectionTarget,
  cameraOrientation,
  clearCadHighlight,
  disposeCadObject,
  frameCadModel,
  meshLabel,
  switchCadProjection,
  viewDirection,
} from "@/lib/cad/three-viewport";

describe("CAD mesh coordinates", () => {
  it("converts Y-up metres to Z-up millimetres without changing handedness", () => {
    const root = cadModelTransform();
    root.updateMatrixWorld(true);
    const point = new THREE.Vector3(0.02, 0.03, 0.04).applyMatrix4(root.matrixWorld);
    expect(point.x).toBeCloseTo(20);
    expect(point.y).toBeCloseTo(-40);
    expect(point.z).toBeCloseTo(30);
    expect(root.matrixWorld.determinant()).toBeGreaterThan(0);
  });

  it("leaves native Z-up millimetre export unchanged", () => {
    const root = cadModelTransform("z", "mm");
    root.updateMatrixWorld(true);
    expect(new THREE.Vector3(20, 30, 40).applyMatrix4(root.matrixWorld).toArray()).toEqual([
      20, 30, 40,
    ]);
    expect(() => cadModelTransform("x", "mm")).toThrow();
    expect(() => cadModelTransform("z", "unknown")).toThrow();
  });
});

describe("camera framing", () => {
  const bounds = new THREE.Box3(new THREE.Vector3(80, -30, 10), new THREE.Vector3(180, 30, 50));

  it.each([0.4, 1, 2.5])("keeps off-origin geometry visible at aspect %s", (aspect) => {
    const camera = new THREE.PerspectiveCamera(40, aspect);
    camera.up.set(0, 0, 1);
    camera.position
      .copy(bounds.getCenter(new THREE.Vector3()))
      .addScaledVector(viewDirection("iso"), 100);
    const result = frameCadModel(camera, bounds, aspect);
    expect(result.target.toArray()).toEqual([130, 0, 30]);
    camera.updateMatrixWorld(true);
    for (const x of [80, 180])
      for (const y of [-30, 30])
        for (const z of [10, 50]) {
          const projected = new THREE.Vector3(x, y, z).project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(1);
          expect(Math.abs(projected.y)).toBeLessThan(1);
          expect(projected.z).toBeGreaterThan(-1);
          expect(projected.z).toBeLessThan(1);
        }
  });

  it("fits orthographic portrait views and rejects empty bounds", () => {
    const camera = new THREE.OrthographicCamera();
    camera.position.set(0, -100, 30);
    frameCadModel(camera, bounds, 0.4);
    expect(camera.right - camera.left).toBeGreaterThan(100);
    expect(camera.top - camera.bottom).toBeGreaterThan(camera.right - camera.left);
    expect(() => frameCadModel(camera, new THREE.Box3(), 1)).toThrow();
  });

  it("preserves projected scale across perspective/orthographic switching", () => {
    const camera = new THREE.PerspectiveCamera(40, 1.5);
    const target = new THREE.Vector3(100, 0, 0);
    camera.up.set(0, 0, 1);
    camera.position.set(100, -200, 0);
    camera.lookAt(target);
    const ortho = switchCadProjection(camera, target, 1.5) as THREE.OrthographicCamera;
    expect(ortho.top).toBeCloseTo(200 * Math.tan(THREE.MathUtils.degToRad(20)));
    ortho.zoom = 2;
    const perspective = switchCadProjection(ortho, target, 1.5);
    expect(perspective.position.distanceTo(target)).toBeCloseTo(100);
    expect(perspective.up.toArray()).toEqual([0, 0, 1]);
  });

  it("reports actual camera orientation for gizmo alignment", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.copy(viewDirection("right"));
    expect(cameraOrientation(camera, new THREE.Vector3()).yawDeg).toBeCloseTo(90);
    camera.position.copy(viewDirection("top"));
    expect(cameraOrientation(camera, new THREE.Vector3()).pitchDeg).toBeCloseTo(90, 2);
  });
});

describe("mesh lifetime and labels", () => {
  it("selects the exported solid rather than one of its six face primitives", () => {
    const body = new THREE.Group();
    body.userData.gltfExtensions = { KITTYCAD_boundary_representation: { solid: 0 } };
    const face = new THREE.Mesh();
    body.add(face);
    expect(cadSelectionTarget(face)).toBe(body);
    expect(meshLabel(face)).toBe("Body 1");
    body.userData.name = "Outer housing";
    body.name = "Outer_housing";
    expect(meshLabel(face)).toBe("Outer housing");
  });
  it("reads foundry instance identity from labeled assembly meshes", () => {
    const mesh = new THREE.Mesh();
    mesh.userData.assemblyLabel = "foundry:enclosure:instance-enclosure:Lower housing";
    mesh.userData.assemblyComponentId = "enclosure";
    expect(meshLabel(mesh)).toBe("Lower housing");
    expect(assemblyComponentId(mesh)).toBe("enclosure");
    const child = new THREE.Mesh();
    child.userData.assemblyLabel = "foundry:pcb-1:instance-pcb:Main board|U1";
    expect(meshLabel(child)).toBe("U1 · Main board");
    expect(assemblyComponentId(child)).toBe("pcb-1");
  });

  it("tints only the highlighted solid and restores the shared material", () => {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const highlighted = new THREE.Mesh(geometry, material);
    const neighbor = new THREE.Mesh(geometry, material);
    applyCadHighlight([highlighted]);
    expect(highlighted.material).not.toBe(material);
    const tinted = highlighted.material as THREE.MeshStandardMaterial;
    expect(tinted.emissive.getHex()).toBe(CAD_HIGHLIGHT_COLOR);
    expect(tinted.emissiveIntensity).toBeGreaterThan(0.5);
    expect(tinted.color.getHex()).not.toBe(0x888888);
    expect(neighbor.material).toBe(material);
    expect(material.emissive.getHex()).toBe(0);
    expect(highlighted.children.some((child) => child.userData.cadHighlightOverlay)).toBe(true);
    clearCadHighlight(highlighted);
    expect(highlighted.material).toBe(material);
    expect(highlighted.children).toHaveLength(0);
  });

  it("reuses edge geometry across repeated hovers instead of rebuilding it", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30));
    edges.userData.cadEdges = true;
    mesh.add(edges);
    const dispose = vi.spyOn(edges.geometry, "dispose");
    for (let i = 0; i < 3; i += 1) {
      applyCadHighlight([mesh]);
      const overlay = mesh.children.find(
        (child) => child.userData.cadHighlightOverlay,
      ) as THREE.LineSegments;
      expect(overlay.geometry).toBe(edges.geometry);
      clearCadHighlight(mesh);
    }
    expect(dispose).not.toHaveBeenCalled();
    expect(mesh.children).toEqual([edges]);

    const bare = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    applyCadHighlight([bare]);
    const first = (bare.children[0] as THREE.LineSegments).geometry;
    clearCadHighlight(bare);
    applyCadHighlight([bare]);
    expect((bare.children[0] as THREE.LineSegments).geometry).toBe(first);
    expect(cadPickableMeshes(mesh)).toEqual([mesh]);
  });

  it("uses an exported parent name, and keeps unnamed bodies honest", () => {
    const root = new THREE.Group();
    root.name = "housing";
    const mesh = new THREE.Mesh();
    mesh.name = "mesh_0";
    root.add(mesh);
    expect(meshLabel(mesh)).toBe("housing");
    root.name = "";
    expect(meshLabel(mesh)).toBe("Body");
  });

  it("disposes shared geometry, materials and textures once", () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial(),
    );
    root.add(edge);
    const disposers = [geometry, texture, material, edge.geometry, edge.material].map((resource) =>
      vi.spyOn(resource, "dispose"),
    );
    disposeCadObject(root);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });
});
