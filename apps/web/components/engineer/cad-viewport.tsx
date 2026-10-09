"use client";

/** Local Three.js rendering of meshes exported by the authoritative CAD engine. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  Aperture,
  Axis3d,
  BoxSelect,
  Camera,
  Focus,
  Maximize2,
  Move,
  Square,
  ZoomOut,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DotMatrixLoader } from "@/components/dot-matrix-loader";
import { useTheme } from "@/components/theme-provider";
import { useWorkspaceUiPreview } from "@/components/dev/workspace-ui-preview";
import { cadSurfaceColors } from "@/lib/theme";
import {
  orientationForView,
  projectCadAxis,
  type CameraOrientation,
  type NavTool,
} from "@/lib/cad/viewport-input";
import {
  applyCadHighlight,
  assemblyComponentId,
  cadModelTransform,
  cadPickableMeshes,
  cadSelectionTarget,
  cameraOrientation,
  clearCadHighlight,
  collectCadHighlightMeshes,
  disposeCadObject,
  frameCadModel,
  meshLabel,
  switchCadProjection,
  viewDirection,
  type CadCamera,
} from "@/lib/cad/three-viewport";
import { safeCadError } from "@/lib/cad/safe-error";
import type { CadMeshRequest } from "@/lib/cad/mesh-request";
import { CadSceneCache } from "@/lib/cad/scene-cache";
import {
  directViewportMeshSource,
  parseViewportMeshResponse,
} from "@/lib/cad/viewport-mesh-loader";
import { cn } from "@/lib/utils";

export type CadView = "orbit" | "iso" | "front" | "top" | "right" | "back" | "left" | "bottom";
type StandardView = Exclude<CadView, "orbit">;
export type CadMeshAsset = {
  path: string;
  format: string;
  fileUrl: string;
  lengthUnit?: "mm" | "cm" | "m" | "in" | "ft" | "yd";
};
const FIT_PADDING = 0.18;
const NO_MESH_ASSETS: CadMeshAsset[] = [];

function cadSceneBytes(root: THREE.Object3D): number {
  const buffers = new Set<ArrayBufferLike>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    for (const attr of Object.values((object.geometry as THREE.BufferGeometry).attributes))
      buffers.add(
        attr instanceof THREE.InterleavedBufferAttribute
          ? attr.data.array.buffer
          : attr.array.buffer,
      );
    if (object.geometry.index) buffers.add(object.geometry.index.array.buffer);
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
  });
  let bytes = [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
  for (const texture of textures) {
    const image = texture.source.data as { width?: number; height?: number } | null;
    if (image?.width && image.height) bytes += image.width * image.height * 6;
  }
  return bytes;
}

function ToolbarBtn({
  active,
  title,
  onClick,
  disabled,
  children,
  className,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon-xs"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={cn("text-muted-foreground", active && "bg-primary/10 text-primary", className)}
    >
      {children}
    </Button>
  );
}

function Divider() {
  return <div className="bg-border mx-0.5 h-5 w-px shrink-0" />;
}

/** Faces of the 3D navigation cube: CSS transform placing each face. */
const CUBE_SIZE = 64;
const CUBE_FACES: { id: StandardView; label: string; place: string }[] = [
  { id: "front", label: "FRONT", place: "" },
  { id: "back", label: "BACK", place: "rotateY(180deg)" },
  { id: "right", label: "RIGHT", place: "rotateY(90deg)" },
  { id: "left", label: "LEFT", place: "rotateY(-90deg)" },
  { id: "top", label: "TOP", place: "rotateX(90deg)" },
  { id: "bottom", label: "BOT", place: "rotateX(-90deg)" },
];

/**
 * Real 3D navigation cube: rotates with the camera, faces are clickable
 * standard views. CAD yaw/pitch map to CSS as rotateX(-pitch) rotateY(-yaw)
 * (camera orbits the model; the cube counter-rotates to face the camera).
 */
function ViewCube({
  active,
  orientation,
  onSelect,
  onIso,
  disabled,
}: {
  active: StandardView | null;
  orientation: CameraOrientation;
  onSelect: (view: StandardView) => void;
  onIso: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="pointer-events-auto absolute right-3 bottom-14 z-20 flex flex-col items-center gap-1"
      role="group"
      aria-label="Standard camera views"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="flex items-center justify-center"
        style={{ width: CUBE_SIZE + 40, height: CUBE_SIZE + 40, perspective: "420px" }}
      >
        <div
          className="relative transition-transform duration-100"
          style={{
            width: CUBE_SIZE,
            height: CUBE_SIZE,
            transformStyle: "preserve-3d",
            transform: `rotateX(${-orientation.pitchDeg}deg) rotateY(${-orientation.yawDeg}deg)`,
          }}
        >
          {CUBE_FACES.map((face) => (
            <button
              key={face.id}
              type="button"
              disabled={disabled}
              title={`${face.label} view`}
              aria-label={`${face.label} view`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(face.id);
              }}
              className={cn(
                "absolute inset-0 flex items-center justify-center border font-mono text-[9px] font-medium tracking-[0.1em] transition-colors",
                "border-border bg-card/85 text-muted-foreground hover:bg-primary/25 hover:text-primary disabled:opacity-40",
                active === face.id && "border-primary bg-primary/20 text-primary",
              )}
              style={{
                transform: `${face.place} translateZ(${CUBE_SIZE / 2}px)`,
                backfaceVisibility: "hidden",
              }}
            >
              {face.label}
            </button>
          ))}
        </div>
      </div>
      <div className="bg-card flex items-center gap-2 rounded-none border px-1.5 py-0.5">
        <button
          type="button"
          disabled={disabled}
          title="Isometric view"
          aria-label="Isometric view"
          onClick={(event) => {
            event.stopPropagation();
            onIso();
          }}
          className={cn(
            "text-muted-foreground hover:text-primary rounded-none px-1 font-mono text-[9px] font-medium tracking-[0.08em] disabled:opacity-40",
            active === "iso" && "text-primary",
          )}
        >
          ISO
        </button>
        <span className="bg-border h-3 w-px" />
        <span className="flex items-center gap-1.5 text-[8px]">
          {(["X", "Y", "Z"] as const).map((axis) => {
            const projected = projectCadAxis(axis, orientation);
            return (
              <span
                key={axis}
                className={cn(
                  "inline-block font-semibold transition-transform duration-100",
                  axis === "X"
                    ? "text-red-500"
                    : axis === "Y"
                      ? "text-emerald-500"
                      : "text-sky-500",
                )}
                style={{
                  transform: `rotate(${Number(projected.angleDeg.toFixed(3))}deg) scale(${Number((0.75 + projected.scale * 0.25).toFixed(4))})`,
                }}
              >
                {axis}
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}

type ViewportRuntime = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: CadCamera;
  controls: OrbitControls;
  model: THREE.Group | null;
  modelKey: string | null;
  grid: THREE.GridHelper;
  axes: THREE.AxesHelper;
  bounds: THREE.Box3;
  fitted: boolean;
  fit: () => void;
  applyView: (view: CadView) => void;
  resize: () => void;
  edges: (visible: boolean) => void;
  select: (mesh: THREE.Object3D | THREE.Object3D[] | null) => void;
  selectKey: (key: string | null) => void;
  hover: (mesh: THREE.Mesh | null) => void;
};

export function CadViewport({
  engine,
  script,
  projectId,
  renderToken,
  view = "orbit",
  chrome = true,
  headless = false,
  meshAssets = NO_MESH_ASSETS,
  projectFiles,
  entryPath,
  modelKey,
  fitPadding = FIT_PADDING,
  scenery = true,
  debounceMs = 350,
  selectedKey = null,
  selectionHints = [],
  pickOnClick = false,
  onReady,
  onError,
  onSelectObject,
  onCameraOrientationChange,
}: {
  engine?: "build123d" | "zoo";
  script: string;
  projectId?: string;
  renderToken?: string;
  view?: CadView;
  chrome?: boolean;
  headless?: boolean;
  fitPadding?: number;
  scenery?: boolean;
  /** Set to zero when the caller already debounces a complete project snapshot. */
  debounceMs?: number;
  meshAssets?: CadMeshAsset[];
  /** Retained for callers; server export resolves imports from meshAssets. */
  foreignImportOnly?: boolean;
  projectFiles?: Record<string, string>;
  entryPath?: string;
  /** Stable selected-part identity, independent of edits to that part's source. */
  modelKey?: string;
  /** Highlight every mesh that belongs to this manufacturing-part id. */
  selectedKey?: string | null;
  /** Extra names used to highlight older unlabeled assembly meshes. */
  selectionHints?: string[];
  /** Click-without-drag picks a body even while the orbit tool is active. */
  pickOnClick?: boolean;
  onReady?: () => void;
  onError?: (message: string | null) => void;
  onSelectObject?: (key: string | null) => void;
  onCameraOrientationChange?: (orientation: CameraOrientation) => void;
}) {
  const { theme } = useTheme();
  const preview = useWorkspaceUiPreview();
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewportRuntime | null>(null);
  const sceneCache = useRef(new CadSceneCache<THREE.Group>(disposeCadObject));
  const callbacks = useRef({ onReady, onError, onSelectObject, onCameraOrientationChange });
  callbacks.current = { onReady, onError, onSelectObject, onCameraOrientationChange };
  const settings = useRef({ view, fitPadding, scenery, headless, pickOnClick });
  settings.current = { view, fitPadding, scenery, headless, pickOnClick };
  const selectedKeyRef = useRef(selectedKey);
  selectedKeyRef.current = selectedKey;
  const selectionHintsRef = useRef(selectionHints);
  selectionHintsRef.current = selectionHints;
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<"loading" | "building" | "running" | "error">("loading");
  const [loadSource, setLoadSource] = useState<"cache" | "asset" | "engine" | "preview" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<StandardView | null>(
    view === "orbit" ? "iso" : view,
  );
  const [orientation, setOrientation] = useState<CameraOrientation>(
    orientationForView(view === "orbit" ? "iso" : view),
  );
  const [projection, setProjection] = useState("perspective");
  const [edges, setEdges] = useState(true);
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const [axes, setAxes] = useState(scenery);
  const [navTool, setNavTool] = useState<NavTool>("select");
  const navRef = useRef(navTool);
  navRef.current = navTool;
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const hoverTipRef = useRef<HTMLDivElement | null>(null);
  const [retry, setRetry] = useState(0);
  const requestedMesh = useRef(false);

  // One renderer survives edits, camera changes and resizes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      const message =
        "This browser could not start the 3D viewport. Enable hardware acceleration and reload.";
      setError(message);
      setStatus("error");
      callbacks.current.onError?.(message);
      callbacks.current.onReady?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.domElement.setAttribute("aria-label", "Interactive CAD model");
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";
    // The drawing buffer scales with devicePixelRatio; CSS size must stay in
    // layout pixels or Retina screens render an oversized, clipped viewport.
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1c222e");
    scene.add(new THREE.HemisphereLight(0xffffff, 0x59677e, 2));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(100, -150, 200);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb2cfff, 1.5);
    fill.position.set(-120, 80, 60);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 2);
    rim.position.set(0, 100, 200);
    scene.add(rim);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1_000_000);
    camera.up.set(0, 0, 1);
    camera.position.copy(viewDirection("iso")).multiplyScalar(200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.enabled = !settings.current.headless;
    const grid = new THREE.GridHelper(1, 20, 0x8b9aad, 0x6d7b90);
    grid.rotation.x = Math.PI / 2;
    grid.visible = settings.current.scenery;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of gridMaterials) {
      material.transparent = true;
      material.opacity = 0.18;
    }
    scene.add(grid);
    const axisHelper = new THREE.AxesHelper(1);
    axisHelper.visible = settings.current.scenery;
    scene.add(axisHelper);
    let selected: THREE.Object3D[] = [];
    let hovered: THREE.Mesh[] = [];
    let hoveredKey: string | null = null;
    const meshesMatching = (root: THREE.Object3D, key: string | null, extra: string[] = []) => {
      const hints = [key, ...extra, ...selectionHintsRef.current]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase());
      if (!hints.length) return [];
      const matches: THREE.Object3D[] = [];
      root.traverse((object) => {
        if (
          !(object instanceof THREE.Mesh) ||
          object.userData.cadEdges ||
          object.userData.cadHighlightOverlay
        )
          return;
        const identity = assemblyComponentId(object);
        const label =
          `${typeof object.userData.assemblyLabel === "string" ? object.userData.assemblyLabel : ""} ${meshLabel(object)}`.toLowerCase();
        if (
          (identity && hints.includes(identity.toLowerCase())) ||
          hints.some((hint) => hint.length > 1 && label.includes(hint))
        )
          matches.push(cadSelectionTarget(object));
      });
      return [...new Set(matches)];
    };
    const paint = () => {
      if (!runtime.model) return;
      clearCadHighlight(runtime.model);
      const chosen = new Set(collectCadHighlightMeshes(selected));
      applyCadHighlight(
        hovered.filter((mesh) => !chosen.has(mesh)),
        0.32,
      );
      applyCadHighlight([...chosen], 0.62);
    };
    const runtime: ViewportRuntime = {
      scene,
      renderer,
      camera,
      controls,
      model: null,
      modelKey: null,
      grid,
      axes: axisHelper,
      fitted: false,
      bounds: new THREE.Box3(),
      select: (mesh) => {
        selected = !mesh ? [] : Array.isArray(mesh) ? mesh : [mesh];
        paint();
      },
      hover: (mesh) => {
        const key = mesh ? assemblyComponentId(mesh) : null;
        const hoverKey = mesh ? (key ?? mesh.uuid) : null;
        if (hoverKey === hoveredKey) return;
        hoveredKey = hoverKey;
        if (!mesh) {
          hovered = [];
          paint();
          return;
        }
        hovered = key
          ? collectCadHighlightMeshes(
              runtime.model ? meshesMatching(runtime.model, key, [meshLabel(mesh)]) : [mesh],
            )
          : [mesh];
        paint();
      },
      selectKey: (key) => {
        if (!runtime.model) {
          runtime.select(null);
          return;
        }
        const matches = meshesMatching(runtime.model, key);
        runtime.select(matches.length ? matches : null);
      },
      fit: () => {
        if (runtime.bounds.isEmpty()) return;
        const aspect = Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight);
        // Keep the current viewing direction even when the model moved off origin.
        const direction = runtime.camera.position.clone().sub(controls.target).normalize();
        runtime.camera.position.copy(runtime.bounds.getCenter(new THREE.Vector3())).add(direction);
        const fitted = frameCadModel(
          runtime.camera,
          runtime.bounds,
          aspect,
          settings.current.fitPadding,
        );
        controls.target.copy(fitted.target);
        controls.minDistance = fitted.radius * 0.01;
        controls.maxDistance = fitted.radius * 1000;
        controls.update();
      },
      applyView: (nextView) => {
        const standard = nextView === "orbit" ? "iso" : nextView;
        const center = runtime.bounds.isEmpty()
          ? controls.target.clone()
          : runtime.bounds.getCenter(new THREE.Vector3());
        runtime.camera.position.copy(center).addScaledVector(viewDirection(standard), 200);
        controls.target.copy(center);
        runtime.fit();
        controls.update();
        setActiveView(standard);
      },
      resize: () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        renderer.setSize(width, height, false);
        if (runtime.camera instanceof THREE.PerspectiveCamera)
          runtime.camera.aspect = width / height;
        else {
          runtime.camera.left = (-runtime.camera.top * width) / height;
          runtime.camera.right = (runtime.camera.top * width) / height;
        }
        runtime.camera.updateProjectionMatrix();
      },
      edges: (visible) =>
        runtime.model?.traverse((object) => {
          if (object.userData.cadEdges) object.visible = visible;
        }),
    };
    runtimeRef.current = runtime;
    const changed = () => {
      const next = cameraOrientation(runtime.camera, controls.target);
      setOrientation(next);
      callbacks.current.onCameraOrientationChange?.(next);
    };
    controls.addEventListener("change", changed);
    const started = () => {
      setActiveView(null);
      runtime.hover(null);
      setHover(null);
    };
    controls.addEventListener("start", started);
    let pointerDown: { x: number; y: number } | null = null;
    const raycaster = new THREE.Raycaster();
    let pickable: { model: THREE.Object3D; meshes: THREE.Mesh[] } | null = null;
    const hit = (event: PointerEvent): THREE.Mesh | null => {
      if (!runtime.model) return null;
      if (pickable?.model !== runtime.model)
        pickable = { model: runtime.model, meshes: cadPickableMeshes(runtime.model) };
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        runtime.camera,
      );
      const hits = raycaster.intersectObjects(pickable.meshes, false);
      return (hits[0]?.object as THREE.Mesh | undefined) ?? null;
    };
    const down = (event: PointerEvent) => {
      if (event.button === 0 && (event.ctrlKey || event.metaKey)) {
        pointerDown = null;
        event.stopImmediatePropagation();
        return;
      }
      controls.mouseButtons.LEFT = event.altKey ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
      pointerDown = { x: event.clientX, y: event.clientY };
    };
    const canPick = () =>
      !settings.current.headless && (navRef.current === "select" || settings.current.pickOnClick);
    // Coalesce pointer moves to one raycast per frame; moves fire far faster than paints.
    let pendingMove: PointerEvent | null = null;
    let moveFrame = 0;
    const processMove = () => {
      moveFrame = 0;
      const event = pendingMove;
      pendingMove = null;
      if (!event) return;
      if (event.buttons || !canPick()) {
        runtime.hover(null);
        setHover(null);
        return;
      }
      const mesh = hit(event);
      const rect = host.getBoundingClientRect();
      runtime.hover(mesh);
      const name = mesh ? meshLabel(mesh) : null;
      const x = Math.round(event.clientX - rect.left);
      const y = Math.round(event.clientY - rect.top);
      // Follow the cursor without re-rendering; React state changes only with the label.
      const tip = hoverTipRef.current;
      if (tip) {
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
      }
      setHover((current) => (!name ? null : current?.name === name ? current : { name, x, y }));
      renderer.domElement.style.cursor = mesh ? "pointer" : "grab";
    };
    const move = (event: PointerEvent) => {
      pendingMove = event;
      if (!moveFrame) moveFrame = requestAnimationFrame(processMove);
    };
    const up = (event: PointerEvent) => {
      if (
        event.button === 0 &&
        pointerDown &&
        Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) < 4 &&
        canPick()
      ) {
        const mesh = hit(event);
        const key = mesh ? (assemblyComponentId(mesh) ?? meshLabel(mesh)) : null;
        if (key) runtime.selectKey(key);
        else runtime.select(mesh ? cadSelectionTarget(mesh) : null);
        callbacks.current.onSelectObject?.(key);
      }
      pointerDown = null;
    };
    const leave = () => {
      pendingMove = null;
      runtime.hover(null);
      setHover(null);
    };
    const lost = (event: Event) => {
      event.preventDefault();
      const message = "The 3D display was interrupted. Reload the page to restore the viewport.";
      setError(message);
      setStatus("error");
      callbacks.current.onError?.(message);
      callbacks.current.onReady?.();
    };
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", down, true);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("webglcontextlost", lost);
    const resizeObserver = new ResizeObserver(runtime.resize);
    resizeObserver.observe(host);
    runtime.resize();
    // Hidden tabs (the kept-alive Assembly behind a part window, a background
    // browser tab) must not keep rendering the scene every frame.
    let onScreen = true;
    const visibility =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            onScreen = Boolean(entry?.isIntersecting);
          });
    visibility?.observe(host);
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (
        !onScreen ||
        document.hidden ||
        host.clientWidth === 0 ||
        host.checkVisibility?.({ visibilityProperty: true }) === false
      )
        return;
      controls.update();
      renderer.render(scene, runtime.camera);
    };
    tick();
    setMounted(true);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(moveFrame);
      visibility?.disconnect();
      resizeObserver.disconnect();
      controls.dispose();
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("webglcontextlost", lost);
      if (runtime.model && sceneCache.current.owns(runtime.model)) scene.remove(runtime.model);
      sceneCache.current.clear();
      disposeCadObject(scene);
      renderer.dispose();
      canvas.remove();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime)
      runtime.scene.background = new THREE.Color(cadSurfaceColors(theme.mode).background);
  }, [mounted, theme.mode]);

  // Full content and dependency closure, not source length: dimension edits rebuild.
  const requestBody = useMemo(
    () =>
      JSON.stringify({
        engine,
        projectId,
        renderToken,
        script,
        projectFiles,
        entryPath,
        meshAssets,
      }),
    [engine, projectId, renderToken, script, projectFiles, entryPath, meshAssets],
  );
  const selectedModelKey = `${projectId ?? renderToken ?? "local"}:${modelKey ?? entryPath ?? "main"}`;
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!mounted || !runtime) return;
    const controller = new AbortController();
    let stale = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const cache = sceneCache.current;
    const cacheKey = `${selectedModelKey}\n${requestBody}`;
    const changedPart = runtime.modelKey !== selectedModelKey;
    const removeCurrent = () => {
      runtime.select(null);
      if (!runtime.model) return;
      runtime.scene.remove(runtime.model);
      if (!cache.owns(runtime.model)) disposeCadObject(runtime.model);
      runtime.model = null;
    };
    if (changedPart) {
      // Never show the previous part under the newly selected part's name.
      removeCurrent();
      runtime.modelKey = selectedModelKey;
      runtime.fitted = false;
      runtime.bounds.makeEmpty();
      runtime.renderer.render(runtime.scene, runtime.camera);
    }
    setHover(null);
    setError(null);
    callbacks.current.onError?.(null);

    const display = (root: THREE.Group) => {
      const bounds = new THREE.Box3().setFromObject(root);
      removeCurrent();
      runtime.model = root;
      runtime.scene.add(root);
      runtime.bounds.copy(bounds);
      const span = Math.max(1, bounds.getSize(new THREE.Vector3()).length());
      runtime.grid.scale.setScalar(span * 2);
      runtime.grid.position.copy(bounds.getCenter(new THREE.Vector3()));
      runtime.grid.position.z = bounds.min.z - span * 0.005;
      runtime.axes.scale.setScalar(span * 0.2);
      runtime.axes.position.copy(bounds.min);
      runtime.edges(edgesRef.current);
      if (!runtime.fitted || settings.current.headless) runtime.applyView(settings.current.view);
      runtime.fitted = true;
      runtime.selectKey(selectedKeyRef.current ?? null);
      runtime.renderer.render(runtime.scene, runtime.camera);
      setStatus("running");
      requestAnimationFrame(() => {
        if (!stale) callbacks.current.onReady?.();
      });
    };
    const cached = cache.get(cacheKey);
    if (cached) {
      // Restoring a viewed part does not require another export, parse or edge build.
      setLoadSource("cache");
      display(cached);
      return () => {
        stale = true;
      };
    }
    setStatus(runtime.model ? "building" : "loading");
    const timer = setTimeout(
      () => {
        requestedMesh.current = true;
        void (async () => {
          let parsedRoot: THREE.Group | null = null;
          try {
            if (!projectId && !renderToken && process.env.NODE_ENV === "production")
              throw new Error("CAD preview is not configured for this demo");
            deadline = setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, 150_000);
            const direct = preview
              ? null
              : directViewportMeshSource(JSON.parse(requestBody) as CadMeshRequest);
            if (!preview && !direct && engine !== "build123d")
              throw new Error("LEGACY_KCL_REQUIRES_CONVERSION");
            setLoadSource(preview ? "preview" : direct ? "asset" : "engine");
            const response = preview
              ? await preview.meshResponse(requestBody)
              : direct
                ? await fetch(direct.fileUrl, {
                    credentials: "same-origin",
                    redirect: "error",
                    signal: controller.signal,
                  })
                : await fetch("/api/cad/mesh", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: requestBody,
                    signal: controller.signal,
                  });
            const loaded = await parseViewportMeshResponse(response, direct ?? undefined);
            parsedRoot = loaded.scene;
            controller.signal.throwIfAborted();
            if (stale) {
              disposeCadObject(parsedRoot);
              return;
            }
            const root = cadModelTransform(loaded.upAxis, loaded.unit);
            root.add(parsedRoot);
            let meshes = 0;
            parsedRoot.traverse((object) => {
              if (!(object instanceof THREE.Mesh)) return;
              meshes += 1;
              const line = new THREE.LineSegments(
                new THREE.EdgesGeometry(object.geometry, 30),
                new THREE.LineBasicMaterial({ color: 0x263446, transparent: true, opacity: 0.35 }),
              );
              line.userData.cadEdges = true;
              line.visible = edgesRef.current;
              object.add(line);
            });
            root.updateMatrixWorld(true);
            const bounds = new THREE.Box3().setFromObject(root);
            if (!meshes || bounds.isEmpty()) {
              disposeCadObject(root);
              parsedRoot = null;
              throw new Error("CAD model has no solid geometry");
            }
            // Detach the old scene before LRU eviction can release its resources.
            removeCurrent();
            cache.set(cacheKey, root, cadSceneBytes(root) + cacheKey.length * 2);
            parsedRoot = null;
            display(root);
          } catch (err) {
            if (parsedRoot) disposeCadObject(parsedRoot);
            if (stale) return;
            const message =
              !projectId && !renderToken && process.env.NODE_ENV === "production"
                ? "Live CAD previews are unavailable on this public demo. Open a project to inspect geometry."
                : safeCadError(timedOut ? "CAD request timed out" : err);
            setStatus("error");
            setError(message);
            callbacks.current.onError?.(message);
            requestAnimationFrame(() => {
              if (!stale) callbacks.current.onReady?.();
            });
          } finally {
            if (deadline) clearTimeout(deadline);
          }
        })();
      },
      changedPart || headless || !requestedMesh.current ? 0 : debounceMs,
    );
    return () => {
      stale = true;
      clearTimeout(timer);
      if (deadline) clearTimeout(deadline);
      controller.abort();
    };
  }, [
    mounted,
    requestBody,
    selectedModelKey,
    retry,
    projectId,
    renderToken,
    headless,
    debounceMs,
    preview,
    engine,
  ]);

  useEffect(() => {
    runtimeRef.current?.selectKey(selectedKey ?? null);
  }, [selectedKey, selectionHints, status]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime?.fitted) {
      runtime.applyView(view);
      runtime.renderer.render(runtime.scene, runtime.camera);
      const frame = requestAnimationFrame(() => callbacks.current.onReady?.());
      return () => cancelAnimationFrame(frame);
    }
  }, [view]);

  const changeProjection = () => {
    const runtime = runtimeRef.current;
    const host = hostRef.current;
    if (!runtime || !host) return;
    runtime.camera = switchCadProjection(
      runtime.camera,
      runtime.controls.target,
      Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight),
    );
    runtime.controls.object = runtime.camera;
    runtime.controls.update();
    setProjection(
      runtime.camera instanceof THREE.PerspectiveCamera ? "perspective" : "orthographic",
    );
  };
  const zoom = (factor: number) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.camera instanceof THREE.OrthographicCamera) {
      runtime.camera.zoom = THREE.MathUtils.clamp(runtime.camera.zoom * factor, 0.01, 1000);
      runtime.camera.updateProjectionMatrix();
    } else
      runtime.camera.position
        .sub(runtime.controls.target)
        .multiplyScalar(1 / factor)
        .add(runtime.controls.target);
    runtime.controls.update();
  };
  const capture = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.renderer.render(runtime.scene, runtime.camera);
    const a = document.createElement("a");
    a.href = runtime.renderer.domElement.toDataURL("image/png");
    a.download = `foundry-view-${activeView ?? "orbit"}.png`;
    a.click();
  };

  return (
    <div
      className="bg-muted/30 absolute inset-0"
      data-cad-renderer="three"
      data-cad-engine={engine ?? "zoo"}
      data-cad-status={status}
      data-cad-model-key={modelKey ?? entryPath ?? "main"}
      data-cad-selected={selectedKey ?? undefined}
      data-cad-load-source={status === "running" ? loadSource : undefined}
    >
      <div ref={hostRef} className="absolute inset-0" />
      {hover && !headless ? (
        <div
          ref={hoverTipRef}
          className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-none border bg-card px-2 py-1 font-mono text-[11px] shadow-none"
          style={{ left: hover.x, top: hover.y }}
        >
          {hover.name}
        </div>
      ) : null}
      {chrome ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-14 z-20 flex justify-center px-3 pb-3">
            <div className="bg-card pointer-events-auto flex max-w-[min(100%,920px)] items-center gap-0.5 overflow-x-auto rounded-none border px-1.5 py-1 shadow-none">
              <ToolbarBtn
                title="Orbit"
                active={navTool === "orbit"}
                disabled={!mounted}
                onClick={() => {
                  setNavTool("orbit");
                  setHover(null);
                }}
              >
                <Move className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Select"
                active={navTool === "select"}
                disabled={!mounted}
                onClick={() => setNavTool("select")}
              >
                <BoxSelect className="size-3.5" />
              </ToolbarBtn>
              <Divider />
              <ToolbarBtn
                title="Isometric view"
                active={activeView === "iso"}
                disabled={!mounted}
                onClick={() => runtimeRef.current?.applyView("iso")}
                className="min-w-8 px-1 font-mono text-[9px] font-medium tracking-[0.08em]"
              >
                ISO
              </ToolbarBtn>
              <ToolbarBtn
                title="Fit all"
                disabled={!mounted}
                onClick={() => runtimeRef.current?.fit()}
              >
                <Maximize2 className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn title="Zoom in" disabled={!mounted} onClick={() => zoom(1.25)}>
                <Focus className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn title="Zoom out" disabled={!mounted} onClick={() => zoom(0.8)}>
                <ZoomOut className="size-3.5" />
              </ToolbarBtn>
              <Divider />
              <ToolbarBtn
                title={
                  projection === "perspective"
                    ? "Orthographic projection"
                    : "Perspective projection"
                }
                active={projection === "orthographic"}
                disabled={!mounted}
                onClick={changeProjection}
              >
                <Aperture className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Toggle edge lines"
                active={edges}
                disabled={!mounted}
                onClick={() => {
                  setEdges(!edges);
                  runtimeRef.current?.edges(!edges);
                }}
              >
                <Square className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Toggle axes gizmo"
                active={axes}
                disabled={!mounted}
                onClick={() => {
                  setAxes(!axes);
                  if (runtimeRef.current) {
                    runtimeRef.current.axes.visible = !axes;
                    runtimeRef.current.grid.visible = !axes;
                  }
                }}
              >
                <Axis3d className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Capture PNG of current view"
                disabled={status !== "running"}
                onClick={capture}
              >
                <Camera className="size-3.5" />
              </ToolbarBtn>
              <span className="text-muted-foreground ml-1 hidden px-1 font-mono text-[9px] tracking-[0.06em] uppercase sm:inline">
                {projection === "orthographic" ? "Ortho" : "Persp"}
                {edges ? " · Edges" : ""}
              </span>
            </div>
          </div>
          <ViewCube
            active={activeView}
            orientation={orientation}
            disabled={!mounted}
            onSelect={(next) => runtimeRef.current?.applyView(next)}
            onIso={() => runtimeRef.current?.applyView("iso")}
          />
          <div className="text-muted-foreground pointer-events-none absolute bottom-3 left-3 z-20 hidden items-center gap-2 font-mono text-[9px] tracking-[0.04em] 2xl:flex">
            <span className="text-foreground/85 font-medium">mm · Z-up</span>
            <span className="bg-border h-3 w-px" />
            <span>Drag orbit · Shift-drag pan · Scroll zoom</span>
          </div>
        </>
      ) : null}
      {status === "error" && error ? (
        <div
          role="alert"
          className="bg-card absolute top-24 left-1/2 z-30 w-[min(90%,380px)] -translate-x-1/2 rounded-none border px-4 py-3 text-center text-xs shadow-none"
        >
          <p>{error}</p>
          {mounted ? (
            <button
              type="button"
              className="text-primary mt-3 inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.08em] uppercase"
              onClick={() => setRetry((value) => value + 1)}
            >
              <RefreshCw className="size-3" />
              Retry model
            </button>
          ) : null}
        </div>
      ) : status === "loading" ? (
        <DotMatrixLoader
          className="pointer-events-none absolute inset-0 z-10"
          tone="signal"
          label="Building geometry"
        />
      ) : null}
    </div>
  );
}
