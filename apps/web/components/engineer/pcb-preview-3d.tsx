"use client";

/**
 * Approximate 3D preview of the PCB layout (FR4 substrate + footprint
 * bodies/pads). Not STEP package models — placement/outline visualization.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { footprintDef, type PcbDoc } from "@/lib/pcb/doc";
import { useTheme } from "@/components/theme-provider";
import { cadSurfaceColors } from "@/lib/theme";

const FR4 = 0x2d5a3d;
const COPPER = 0xc06040;
const COPPER_BACK = 0x5060c0;
const BODY = 0x1a1a1a;
const SILK = 0xe8e8e0;
const PAD_H = 0.035;
const BODY_H = 0.8;

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) m.dispose();
    }
  });
}

function buildScene(doc: PcbDoc): THREE.Group {
  const root = new THREE.Group();
  const { widthMm: w, heightMm: h, thicknessMm: t, cornerRadiusMm: r } = doc.board;
  const radius = Math.min(r, w / 2, h / 2);

  const boardMat = new THREE.MeshStandardMaterial({
    color: FR4,
    roughness: 0.75,
    metalness: 0.05,
  });
  const corner = Math.max(0, Math.min(radius, t / 2 - 0.02, w / 2 - 0.02, h / 2 - 0.02));
  const boardGeom =
    corner > 0.05 ? new RoundedBoxGeometry(w, t, h, 4, corner) : new THREE.BoxGeometry(w, t, h);
  root.add(new THREE.Mesh(boardGeom, boardMat));

  const topCu = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(0.1, w - 0.4), 0.02, Math.max(0.1, h - 0.4)),
    new THREE.MeshStandardMaterial({
      color: 0x1f4a32,
      roughness: 0.6,
      metalness: 0.15,
    }),
  );
  topCu.position.y = t / 2 + 0.011;
  root.add(topCu);

  for (const fp of doc.footprints) {
    const def = footprintDef(fp.libraryId);
    if (!def) continue;

    const group = new THREE.Group();
    // PCB (0,0) top-left → three centred board; +Y pcb maps to +Z three.
    group.position.set(fp.xMm - w / 2, fp.side === "front" ? t / 2 : -t / 2, fp.yMm - h / 2);
    group.rotation.y = THREE.MathUtils.degToRad(-fp.rotationDeg);
    if (fp.side === "back") group.rotation.x = Math.PI;

    const ySign = 1; // local +Y is away from board after flip
    const isHole = fp.libraryId.startsWith("MountingHole");

    if (isHole) {
      const hole = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 1.6, t + 0.2, 24),
        new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
      );
      group.add(hole);
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(3, 3, 0.05, 24),
        new THREE.MeshStandardMaterial({
          color: COPPER,
          metalness: 0.7,
          roughness: 0.35,
        }),
      );
      ring.position.y = PAD_H / 2 + 0.01;
      group.add(ring);
    } else {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(def.bodyWMm, BODY_H, def.bodyHMm),
        new THREE.MeshStandardMaterial({
          color: BODY,
          roughness: 0.55,
          metalness: 0.2,
        }),
      );
      body.position.y = ySign * (BODY_H / 2 + 0.02);
      group.add(body);

      const label = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(def.bodyWMm, 2.2), 0.02, 0.4),
        new THREE.MeshStandardMaterial({ color: SILK, roughness: 0.8 }),
      );
      label.position.y = BODY_H + 0.04;
      group.add(label);

      const copper = fp.side === "front" ? COPPER : COPPER_BACK;
      for (const pad of def.pads) {
        const padMesh = new THREE.Mesh(
          pad.shape === "oval"
            ? new THREE.CylinderGeometry(
                Math.min(pad.wMm, pad.hMm) / 2,
                Math.min(pad.wMm, pad.hMm) / 2,
                PAD_H,
                16,
              )
            : new THREE.BoxGeometry(pad.wMm, PAD_H, pad.hMm),
          new THREE.MeshStandardMaterial({
            color: copper,
            metalness: 0.75,
            roughness: 0.3,
          }),
        );
        padMesh.position.set(pad.xMm, PAD_H / 2 + 0.01, pad.yMm);
        group.add(padMesh);
      }
    }

    root.add(group);
  }

  return root;
}

export function PcbPreview3d({ doc }: { doc: PcbDoc }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const runtime = useRef<{
    scene: THREE.Scene;
    rebuild: (doc: PcbDoc) => void;
    setBg: (hex: string) => void;
  } | null>(null);

  // Mount WebGL once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(40, 80, 30);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xaaccff, 0.35);
    fill.position.set(-50, 20, -40);
    scene.add(fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    let boardRoot: THREE.Group | null = null;
    let fitted = false;

    const rebuild = (d: PcbDoc) => {
      if (boardRoot) {
        scene.remove(boardRoot);
        disposeObject(boardRoot);
      }
      boardRoot = buildScene(d);
      scene.add(boardRoot);
      if (!fitted) {
        const span = Math.max(d.board.widthMm, d.board.heightMm, 20);
        const dist = span * 1.6;
        camera.position.set(dist * 0.7, dist * 0.75, dist * 0.7);
        controls.target.set(0, 0, 0);
        controls.update();
        fitted = true;
      }
    };

    runtime.current = {
      scene,
      rebuild,
      setBg: (hex) => {
        scene.background = new THREE.Color(hex);
      },
    };
    runtime.current.setBg(cadSurfaceColors(theme.mode).background);
    rebuild(doc);

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = host;
      if (width < 2 || height < 2) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      if (boardRoot) disposeObject(boardRoot);
      renderer.dispose();
      runtime.current = null;
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
    // theme/doc applied in sibling effects; mount is once.
  }, []);

  useEffect(() => {
    runtime.current?.setBg(cadSurfaceColors(theme.mode).background);
  }, [theme.mode]);

  useEffect(() => {
    runtime.current?.rebuild(doc);
  }, [doc]);

  return (
    <div className="absolute inset-0">
      <div ref={hostRef} className="absolute inset-0" aria-label="PCB 3D preview" />
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
        <span className="bg-card/85 text-muted-foreground rounded-none border px-2.5 py-1 text-[11px] shadow backdrop-blur-md">
          3D preview · drag to orbit · scroll to zoom · approximate packages
        </span>
      </div>
    </div>
  );
}
