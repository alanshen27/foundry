import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { normalizePcbDoc } from "@/lib/pcb/doc";
import { pcbPreviewBoardGeometry } from "@/lib/pcb/preview-geometry";

describe("PCB 3D physical substrate", () => {
  it("renders the specified outline, thickness and a real mounting through-hole", () => {
    const doc = normalizePcbDoc({
      board: { widthMm: 40, heightMm: 30, thicknessMm: 2.4, cornerRadiusMm: 4 },
      footprints: [{ id: "h", libraryId: "MountingHole_3.2mm", refDes: "H1", xMm: 10, yMm: 12 }],
    });
    const geometry = pcbPreviewBoardGeometry(doc);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(40);
    expect(size.y).toBeCloseTo(2.4);
    expect(size.z).toBeCloseTo(30);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    const hits = (x: number, z: number) =>
      new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0)).intersectObject(
        mesh,
      ).length;
    expect(hits(-10, -3)).toBe(0);
    expect(hits(-8, -3)).toBeGreaterThan(0);
    expect(hits(-19.9, -14.9)).toBe(0);
    expect(hits(0, 0)).toBeGreaterThan(0);
    geometry.dispose();
    material.dispose();
  });

  it.each([undefined, null, 0, -1, NaN, Infinity, 501])(
    "leaves unknown or invalid package height %s unset",
    (bodyHeightMm) => {
      const doc = normalizePcbDoc({ footprints: [{ id: "r", libraryId: "R_0603", bodyHeightMm }] });
      expect(doc.footprints[0]?.bodyHeightMm).toBeUndefined();
    },
  );

  it("round-trips explicitly supplied package height", () => {
    const doc = normalizePcbDoc({
      footprints: [{ id: "r", libraryId: "R_0603", bodyHeightMm: 1.25 }],
    });
    expect(normalizePcbDoc(doc).footprints[0]?.bodyHeightMm).toBe(1.25);
  });
});
