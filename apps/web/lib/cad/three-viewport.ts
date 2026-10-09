import * as THREE from "three";
import { assemblyMeshDisplayName, parseAssemblyInstanceLabel } from "@foundry/cad";
import { orientationForView, type CameraOrientation, type CameraViewId } from "./viewport-input";

export type CadCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/** Convert exported glTF axes/units once; the viewport operates in CAD mm/Z-up. */
export function cadModelTransform(upAxis = "y", unit = "m"): THREE.Group {
  const root = new THREE.Group();
  const scales: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, yd: 914.4 };
  if (!(unit in scales) || !["y", "z"].includes(upAxis)) {
    throw new Error("Unsupported CAD mesh coordinate system");
  }
  root.scale.setScalar(scales[unit]!);
  if (upAxis === "y") root.rotation.x = Math.PI / 2;
  return root;
}

export function viewDirection(view: CameraViewId): THREE.Vector3 {
  const { yawDeg, pitchDeg } = orientationForView(view);
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  // A minute offset at the poles preserves a stable Z-up camera and orbit.
  const pitch = THREE.MathUtils.degToRad(Math.max(-89.999, Math.min(89.999, pitchDeg)));
  return new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
    Math.sin(pitch),
  );
}

export function cameraOrientation(camera: THREE.Camera, target: THREE.Vector3): CameraOrientation {
  const direction = camera.position.clone().sub(target).normalize();
  return {
    yawDeg: THREE.MathUtils.radToDeg(Math.atan2(direction.x, -direction.y)),
    pitchDeg: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(direction.z, -1, 1))),
  };
}

/** Fit a bounding sphere, including portrait canvases and off-origin models. */
export function frameCadModel(
  camera: CadCamera,
  bounds: THREE.Box3,
  aspect: number,
  padding = 0.18,
): {
  target: THREE.Vector3;
  radius: number;
} {
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  if (bounds.isEmpty() || !Number.isFinite(sphere.radius))
    throw new Error("No renderable geometry");
  const radius = Math.max(sphere.radius, 0.01);
  const padded = radius * (1 + Math.max(0, padding));
  const safeAspect = Math.max(0.01, aspect);
  const direction = camera.position.clone().sub(sphere.center).normalize();
  if (direction.lengthSq() < 0.5) direction.copy(viewDirection("iso"));
  let distance: number;
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = safeAspect;
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * safeAspect);
    distance = padded / Math.sin(Math.min(vertical, horizontal));
  } else {
    const halfHeight = padded / Math.min(1, safeAspect);
    camera.left = -halfHeight * safeAspect;
    camera.right = halfHeight * safeAspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.zoom = 1;
    distance = padded * 3;
  }
  camera.position.copy(sphere.center).addScaledVector(direction, distance);
  camera.near = Math.max(0.001, radius / 10_000);
  camera.far = Math.max(10, distance + radius * 2000);
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
  return { target: sphere.center, radius };
}

/** Preserve framing when changing projection rather than jumping back to home. */
export function switchCadProjection(
  camera: CadCamera,
  target: THREE.Vector3,
  aspect: number,
): CadCamera {
  const distance = Math.max(0.001, camera.position.distanceTo(target));
  let next: CadCamera;
  if (camera instanceof THREE.PerspectiveCamera) {
    const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    next = new THREE.OrthographicCamera(
      -halfHeight * aspect,
      halfHeight * aspect,
      halfHeight,
      -halfHeight,
      camera.near,
      camera.far,
    );
  } else {
    next = new THREE.PerspectiveCamera(40, aspect, camera.near, camera.far);
    const halfHeight = (camera.top - camera.bottom) / (2 * camera.zoom);
    const newDistance = halfHeight / Math.tan(THREE.MathUtils.degToRad(next.fov / 2));
    next.position
      .copy(target)
      .addScaledVector(camera.position.clone().sub(target).normalize(), newDistance);
  }
  if (camera instanceof THREE.PerspectiveCamera) next.position.copy(camera.position);
  next.up.copy(camera.up);
  next.quaternion.copy(camera.quaternion);
  next.updateProjectionMatrix();
  return next;
}

export function meshLabel(object: THREE.Object3D): string {
  let current: THREE.Object3D | null = object;
  while (current && !(current instanceof THREE.Scene)) {
    const labeled =
      typeof current.userData.assemblyLabel === "string"
        ? current.userData.assemblyLabel.trim()
        : "";
    if (labeled) return assemblyMeshDisplayName(labeled);
    const name =
      typeof current.userData.name === "string"
        ? current.userData.name.trim()
        : current.name.trim();
    if (name && !/^(?:mesh|node|scene)[_\s-]?\d*$/i.test(name))
      return assemblyMeshDisplayName(name);
    const solid = current.userData.gltfExtensions?.KITTYCAD_boundary_representation?.solid;
    if (Number.isInteger(solid) && solid >= 0) return `Body ${solid + 1}`;
    current = current.parent;
  }
  return "Body";
}

export function assemblyComponentId(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current && !(current instanceof THREE.Scene)) {
    if (typeof current.userData.assemblyComponentId === "string")
      return current.userData.assemblyComponentId;
    const labeled =
      typeof current.userData.assemblyLabel === "string"
        ? current.userData.assemblyLabel
        : current.userData.name;
    const parsed = typeof labeled === "string" ? parseAssemblyInstanceLabel(labeled) : null;
    if (parsed) return parsed.componentId;
    current = current.parent;
  }
  return null;
}

export const CAD_HIGHLIGHT_COLOR = 0xff5a00;

function highlightable(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return (
    "emissive" in material &&
    (material as THREE.MeshStandardMaterial).emissive instanceof THREE.Color
  );
}

/** Solid meshes only: edge lines and highlight overlays are not pickable. */
export function cadPickableMeshes(root: THREE.Object3D): THREE.Mesh[] {
  return meshSolids(root);
}

/** Reuse the viewport's edge lines (or one cached copy) instead of rebuilding per hover. */
function highlightEdges(mesh: THREE.Mesh): THREE.BufferGeometry {
  const existing = mesh.children.find(
    (child): child is THREE.LineSegments =>
      child instanceof THREE.LineSegments && Boolean(child.userData.cadEdges),
  );
  if (existing) return existing.geometry;
  const cached = mesh.userData.cadHighlightEdges as THREE.BufferGeometry | undefined;
  if (cached) return cached;
  const edges = new THREE.EdgesGeometry(mesh.geometry, 25);
  mesh.userData.cadHighlightEdges = edges;
  return edges;
}

function meshSolids(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      !object.userData.cadEdges &&
      !object.userData.cadHighlightOverlay
    )
      meshes.push(object);
  });
  return meshes;
}

export function collectCadHighlightMeshes(targets: readonly THREE.Object3D[]): THREE.Mesh[] {
  const seen = new Set<THREE.Mesh>();
  for (const target of targets) for (const mesh of meshSolids(target)) seen.add(mesh);
  return [...seen];
}

export function clearCadHighlight(root: THREE.Object3D | null | undefined) {
  if (!root) return;
  const overlays: THREE.Object3D[] = [];
  const clones = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object.userData.cadHighlightOverlay) overlays.push(object);
    if (!(object instanceof THREE.Mesh) || !object.userData.cadHighlightMaterials) return;
    const tinted = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of tinted) clones.add(material);
    object.material = object.userData.cadHighlightMaterials as THREE.Material | THREE.Material[];
    delete object.userData.cadHighlightMaterials;
  });
  for (const overlay of overlays) {
    overlay.parent?.remove(overlay);
    // The edge geometry is shared with the mesh; only the overlay material is owned.
    ((overlay as THREE.LineSegments).material as THREE.Material).dispose();
  }
  for (const material of clones) material.dispose();
}

/** Tint the solid itself. Clones materials so a cached assembly scene is not mutated. */
export function applyCadHighlight(meshes: readonly THREE.Mesh[], intensity = 0.55) {
  const accent = new THREE.Color(CAD_HIGHLIGHT_COLOR);
  for (const mesh of collectCadHighlightMeshes(meshes)) {
    if (mesh.userData.cadHighlightMaterials) continue;
    const original = mesh.material;
    mesh.userData.cadHighlightMaterials = original;
    const list = Array.isArray(original) ? original : [original];
    const tinted = list.map((material) => {
      const next = material.clone();
      if (highlightable(next)) {
        next.emissive.copy(accent);
        next.emissiveIntensity = Math.max(intensity, 0.75);
        next.color.lerp(accent, 0.72);
        next.metalness = Math.min(next.metalness, 0.12);
        next.roughness = Math.max(next.roughness, 0.4);
      }
      return next;
    });
    mesh.material = Array.isArray(original) ? tinted : tinted[0]!;
    const overlay = new THREE.LineSegments(
      highlightEdges(mesh),
      new THREE.LineBasicMaterial({
        color: CAD_HIGHLIGHT_COLOR,
        transparent: true,
        opacity: Math.min(1, intensity + 0.4),
        depthTest: false,
      }),
    );
    overlay.userData.cadHighlightOverlay = true;
    overlay.renderOrder = 20;
    mesh.add(overlay);
  }
}

/** Zoo exports a solid as several face primitives; select their shared body. */
export function cadSelectionTarget(mesh: THREE.Mesh): THREE.Object3D {
  let current: THREE.Object3D | null = mesh;
  while (current) {
    const solid = current.userData.gltfExtensions?.KITTYCAD_boundary_representation?.solid;
    if (Number.isInteger(solid) && solid >= 0) return current;
    current = current.parent;
  }
  return mesh;
}

/** Shared geometries, materials, and texture maps are disposed exactly once. */
export function disposeCadObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const drawable = object as THREE.Mesh;
    if (drawable.geometry) geometries.add(drawable.geometry);
    if (object.userData.cadHighlightEdges instanceof THREE.BufferGeometry)
      geometries.add(object.userData.cadHighlightEdges);
    if (drawable.material) {
      for (const material of Array.isArray(drawable.material)
        ? drawable.material
        : [drawable.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}
