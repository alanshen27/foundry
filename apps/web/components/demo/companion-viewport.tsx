"use client";

/**
 * Standalone three.js viewport for the /demo/engineer route: a finished
 * e-ink desk companion rendered locally (no Zoo engine, no DB). Parameters
 * rebuild the model live so the demo reads like a working parametric CAD.
 */
import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { useTheme } from "@/components/theme-provider";
import { cadSurfaceColors } from "@/lib/theme";

export type CompanionParams = {
  bodyWidthMm: number;
  bodyHeightMm: number;
  standAngleDeg: number;
  cornerRadiusMm: number;
  showKnob: boolean;
  showKickstand: boolean;
};

export const DEFAULT_COMPANION_PARAMS: CompanionParams = {
  bodyWidthMm: 148,
  bodyHeightMm: 98,
  standAngleDeg: 22,
  cornerRadiusMm: 6,
  showKnob: true,
  showKickstand: true,
};

export type CompanionView = "iso" | "front" | "back" | "left" | "right" | "top" | "bottom";

const SHELL = 0xe8e4dc;
const SHELL_DARK = 0x2b2b2b;
const ACCENT = 0xff5a00;
const INK = 0x1c1c1c;

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) m.dispose();
    }
  });
}

/** Draws the "running firmware" dashboard onto the e-ink panel texture. */
function drawEinkScreen(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#edeae2";
  ctx.fillRect(0, 0, w, h);

  // Subtle e-ink grain.
  ctx.fillStyle = "rgba(0,0,0,0.04)";
  for (let i = 0; i < 900; i++) {
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  const pad = w * 0.06;
  ctx.fillStyle = "#1d1d1d";
  ctx.textBaseline = "top";

  ctx.font = `600 ${Math.round(h * 0.058)}px "IBM Plex Mono", monospace`;
  ctx.fillText("TUE JUL 29", pad, pad);
  ctx.textAlign = "right";
  ctx.fillText("BAT 87%", w - pad, pad);
  ctx.textAlign = "left";

  ctx.font = `600 ${Math.round(h * 0.3)}px "IBM Plex Mono", monospace`;
  ctx.fillText("09:41", pad - w * 0.008, h * 0.14);

  ctx.font = `500 ${Math.round(h * 0.06)}px "IBM Plex Mono", monospace`;
  ctx.fillText("21°C · PARTLY CLOUDY", pad, h * 0.47);

  // Divider (dotted, e-ink style).
  ctx.fillStyle = "#4a4a4a";
  for (let x = pad; x < w - pad; x += 9) ctx.fillRect(x, h * 0.57, 4, 2);

  const tasks: [string, boolean][] = [
    ["Ship enclosure rev C", true],
    ["Standup 10:30 — hardware", false],
    ['Order 2.9" e-ink panels', false],
  ];
  ctx.font = `500 ${Math.round(h * 0.062)}px "IBM Plex Mono", monospace`;
  tasks.forEach(([label, done], i) => {
    const y = h * 0.63 + i * h * 0.1;
    const box = h * 0.05;
    ctx.strokeStyle = "#1d1d1d";
    ctx.lineWidth = 2;
    ctx.strokeRect(pad, y + 2, box, box);
    ctx.fillStyle = "#1d1d1d";
    if (done) {
      ctx.fillRect(pad + 4, y + 6, box - 8, box - 8);
    }
    ctx.fillText(label, pad + box + w * 0.025, y);
    if (done) {
      ctx.fillRect(pad + box + w * 0.025, y + h * 0.033, ctx.measureText(label).width, 2);
    }
  });
}

function makeScreenTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  if (ctx) drawEinkScreen(ctx, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Builds the desk companion. Y-up; unit = mm; sits on y=0 desk.
 * `stage` grows the model for the scripted demo: 1 = enclosure,
 * 2 = + display module, 3 = finished product.
 */
function buildCompanion(p: CompanionParams, screenTex: THREE.Texture, stage: number): THREE.Group {
  const root = new THREE.Group();
  if (stage < 1) return root;

  const W = p.bodyWidthMm;
  const H = p.bodyHeightMm;
  const T = 14; // body thickness
  const angle = THREE.MathUtils.degToRad(p.standAngleDeg);
  const corner = Math.max(1, Math.min(p.cornerRadiusMm, T / 2 - 0.5));

  const shellMat = new THREE.MeshStandardMaterial({
    color: SHELL,
    roughness: 0.55,
    metalness: 0.08,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: SHELL_DARK,
    roughness: 0.6,
    metalness: 0.2,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: ACCENT,
    roughness: 0.45,
    metalness: 0.15,
  });
  const inkMat = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.9 });

  // Tilted body group: rotate around bottom edge so the base stays on desk.
  const body = new THREE.Group();
  body.rotation.x = -angle;
  body.position.y = (H / 2) * Math.cos(angle) + (T / 2) * Math.sin(angle);
  root.add(body);

  // Enclosure shell.
  body.add(new THREE.Mesh(new RoundedBoxGeometry(W, H, T, 4, corner), shellMat));

  // Screen recess (bezel) + e-ink panel with dashboard texture.
  const bezelW = W - 16;
  const bezelH = H - 24;
  if (stage < 2) return root;
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(bezelW, bezelH, 2.4, 3, 1.5), darkMat);
  bezel.position.set(0, 4, T / 2);
  body.add(bezel);

  const screenMat = new THREE.MeshStandardMaterial({
    map: screenTex,
    roughness: 0.85,
    metalness: 0,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(bezelW - 8, bezelH - 8), screenMat);
  screen.position.set(0, 4, T / 2 + 1.25);
  body.add(screen);

  if (stage < 3) return root;

  // Front accent strip under the display (speaker/status grille).
  const strip = new THREE.Mesh(new THREE.BoxGeometry(W - 24, 3, 0.8), accentMat);
  strip.position.set(0, -H / 2 + 6.5, T / 2 + 0.3);
  body.add(strip);
  for (let i = 0; i < 12; i++) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 12), inkMat);
    hole.rotation.x = Math.PI / 2;
    hole.position.set(-W / 4 + (i * (W / 2)) / 11, -H / 2 + 6.5, T / 2 + 0.6);
    body.add(hole);
  }

  // Rotary knob on the right edge.
  if (p.showKnob) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 8, 40), darkMat);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(W / 2 + 3, H / 4, 0);
    body.add(knob);
    const knobMark = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 8), accentMat);
    knobMark.position.set(W / 2 + 7.2, H / 4, 0);
    body.add(knobMark);
  }

  // Two side buttons below the knob.
  for (let i = 0; i < 2; i++) {
    const btn = new THREE.Mesh(new RoundedBoxGeometry(3, 10, 4, 2, 1.2), darkMat);
    btn.position.set(W / 2 + 0.8, -2 - i * 15, 0);
    body.add(btn);
  }

  // USB-C slot on the bottom rear.
  const usb = new THREE.Mesh(new RoundedBoxGeometry(10, 3.4, 2, 2, 1.2), inkMat);
  usb.position.set(0, -H / 2 + 0.2, -T / 2 + 3);
  usb.rotation.x = Math.PI / 2;
  body.add(usb);

  // Kickstand: rear leg propping the tilt.
  if (p.showKickstand) {
    const legLen = H * 0.62;
    const stand = new THREE.Group();
    const leg = new THREE.Mesh(new RoundedBoxGeometry(W * 0.5, legLen, 3, 2, 1.4), shellMat);
    leg.position.y = -legLen / 2;
    stand.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, W * 0.5, 20), darkMat);
    foot.rotation.z = Math.PI / 2;
    foot.position.y = -legLen;
    stand.add(foot);
    stand.rotation.x = angle * 2.2;
    stand.position.set(0, H * 0.3, -T / 2);
    body.add(stand);
  }

  // Rubber feet along the front bottom edge.
  for (const x of [-W / 2 + 12, W / 2 - 12]) {
    const footPad = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 1.6, 20), inkMat);
    const local = new THREE.Vector3(x, -H / 2 + 1, T / 2 - 4);
    local.applyAxisAngle(new THREE.Vector3(1, 0, 0), -angle);
    footPad.position.copy(local).add(new THREE.Vector3(0, body.position.y - 0.4, 0));
    root.add(footPad);
  }

  return root;
}

function buildDeskGrid(mode: "dark" | "light"): THREE.Group {
  const colors = cadSurfaceColors(mode);
  const group = new THREE.Group();
  const grid = new THREE.GridHelper(700, 56, colors.section, colors.cell);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  group.add(grid);
  return group;
}

const VIEWS: Record<
  CompanionView,
  { pos: [number, number, number]; up?: [number, number, number] }
> = {
  iso: { pos: [170, 130, 190] },
  front: { pos: [0, 70, 260] },
  back: { pos: [0, 70, -260] },
  left: { pos: [-260, 70, 0] },
  right: { pos: [260, 70, 0] },
  top: { pos: [0, 300, 0.01] },
  bottom: { pos: [0, -300, 0.01] },
};

export type CompanionViewportApi = {
  fit: () => void;
  zoomBy: (factor: number) => void;
  applyView: (v: CompanionView) => void;
};

export function CompanionViewport({
  params,
  view,
  spin,
  stage = 3,
  apiRef,
}: {
  params: CompanionParams;
  view: CompanionView;
  /** Slow turntable rotation for the demo video hero shot. */
  spin: boolean;
  /** Scripted build progress: 0 = empty desk, 3 = finished product. */
  stage?: number;
  /** Camera controls for the toolbar (fit / zoom / view). */
  apiRef?: MutableRefObject<CompanionViewportApi | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const runtime = useRef<{
    rebuild: (p: CompanionParams, stage: number) => void;
    applyView: (v: CompanionView) => void;
    setBg: (mode: "dark" | "light") => void;
    setSpin: (on: boolean) => void;
    fit: () => void;
    zoomBy: (factor: number) => void;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 4000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.95));
    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(120, 220, 140);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd0ff, 0.4);
    fill.position.set(-160, 60, -120);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe2c8, 0.5);
    rim.position.set(0, 90, -220);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 45, 0);

    const screenTex = makeScreenTexture();
    let deskGrid = buildDeskGrid("light");
    scene.add(deskGrid);
    let model: THREE.Group | null = null;
    let spinning = false;

    const rebuild = (p: CompanionParams, s: number) => {
      if (model) {
        scene.remove(model);
        disposeObject(model);
      }
      model = buildCompanion(p, screenTex, s);
      scene.add(model);
    };

    const applyView = (v: CompanionView) => {
      const def = VIEWS[v];
      camera.position.set(...def.pos);
      controls.target.set(0, v === "top" || v === "bottom" ? 0 : 45, 0);
      controls.update();
    };

    const fit = () => {
      camera.position.set(...VIEWS.iso.pos).multiplyScalar(0.85);
      controls.target.set(0, 45, 0);
      controls.update();
    };

    const zoomBy = (factor: number) => {
      const dir = camera.position.clone().sub(controls.target);
      camera.position.copy(controls.target).add(dir.multiplyScalar(factor));
      controls.update();
    };

    runtime.current = {
      rebuild,
      applyView,
      setBg: (mode) => {
        scene.background = new THREE.Color(cadSurfaceColors(mode).background);
        scene.remove(deskGrid);
        disposeObject(deskGrid);
        deskGrid = buildDeskGrid(mode);
        scene.add(deskGrid);
      },
      setSpin: (on) => {
        spinning = on;
      },
      fit,
      zoomBy,
    };
    if (apiRef) apiRef.current = { fit, zoomBy, applyView };
    runtime.current.setBg(theme.mode);
    rebuild(params, stage);
    applyView(view);
    spinning = spin;

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
      if (spinning && model) model.rotation.y += 0.0035;
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      if (model) disposeObject(model);
      disposeObject(deskGrid);
      screenTex.dispose();
      renderer.dispose();
      runtime.current = null;
      if (apiRef) apiRef.current = null;
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
    // params/view/theme applied in sibling effects; mount is once.
  }, []);

  useEffect(() => {
    runtime.current?.setBg(theme.mode);
  }, [theme.mode]);

  useEffect(() => {
    runtime.current?.rebuild(params, stage);
  }, [params, stage]);

  useEffect(() => {
    runtime.current?.applyView(view);
  }, [view]);

  useEffect(() => {
    runtime.current?.setSpin(spin);
  }, [spin]);

  return <div ref={hostRef} className="absolute inset-0" aria-label="3D model viewport" />;
}
