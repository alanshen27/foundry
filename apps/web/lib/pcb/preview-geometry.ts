import * as THREE from "three";
import type { PcbDoc } from "./doc";
import { pcbMechanicalProfile } from "./mechanical";

/** Shared mechanical profile, rendered with real outline corners and through-holes. */
export function pcbPreviewBoardGeometry(doc: PcbDoc): THREE.ExtrudeGeometry {
  const profile = pcbMechanicalProfile(doc);
  const { widthMm: w, heightMm: h, thicknessMm: t } = profile;
  const r = Math.max(0, Math.min(profile.cornerRadiusMm, w / 2, h / 2));
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  if (r) shape.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(w / 2, h / 2 - r);
  if (r) shape.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-w / 2 + r, h / 2);
  if (r) shape.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-w / 2, -h / 2 + r);
  if (r) shape.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5, false);
  shape.closePath();
  for (const hole of profile.holes) {
    const path = new THREE.Path();
    path.absarc(hole.xMm, hole.yMm, hole.drillMm / 2, 0, Math.PI * 2, true);
    shape.holes.push(path);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: t,
    bevelEnabled: false,
    curveSegments: 32,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -t / 2, 0);
  return geometry;
}
