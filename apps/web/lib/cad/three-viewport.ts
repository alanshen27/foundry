import * as THREE from "three";
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
    const name =
      typeof current.userData.name === "string"
        ? current.userData.name.trim()
        : current.name.trim();
    if (name && !/^(?:mesh|node|scene)[_\s-]?\d*$/i.test(name)) return name;
    const solid = current.userData.gltfExtensions?.KITTYCAD_boundary_representation?.solid;
    if (Number.isInteger(solid) && solid >= 0) return `Body ${solid + 1}`;
    current = current.parent;
  }
  return "Body";
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
