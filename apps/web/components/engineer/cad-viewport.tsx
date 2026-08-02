"use client";

/**
 * Zoo / KittyCAD WebRTC viewport with CAD-style chrome:
 * standard views, fit/home, ortho/perspective, edges, axes, select/orbit tools.
 *
 * Connection is kept alive across KCL edits — only `executor().submit` re-runs.
 * Stream resolution is capped so 4K layouts don't open a huge WebRTC pipe;
 * SSAO stays on for readable surfaces.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as zoo from "@kittycad/lib";
import {
  Aperture,
  Axis3d,
  BoxSelect,
  Camera,
  Focus,
  Maximize2,
  Move,
  Scan,
  Square,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DotMatrixLoader } from "@/components/dot-matrix-loader";
import {
  entityIdFromHighlight,
  pairSolidNames,
  resolveHoverLabel,
  sceneGetSolidIdsCmd,
  solidIdsFromSceneGet,
} from "@/lib/cad/entity-labels";
import { listCadSolids } from "@/lib/cad/tools";
import {
  cameraOrientationAfterDrag,
  orientationForView,
  projectCadAxis,
  ZOOM_BUTTON_STEP,
  attachViewportInput,
  toStreamPoint,
  type CameraOrientation,
  type NavTool,
  type ViewportInput,
} from "@/lib/cad/viewport-input";
import { safeCadError } from "@/lib/cad/safe-error";
import { cn } from "@/lib/utils";

export type CadView = "orbit" | "iso" | "front" | "top" | "right" | "back" | "left" | "bottom";

type EngineSession = { token: string; baseUrl?: string };
type Projection = "perspective" | "orthographic";
type StandardView = Exclude<CadView, "orbit">;
type ViewportStatus = "connecting" | "executing" | "running" | "error";

/**
 * Stream size in *physical* pixels, capped so 4K panels don't open a
 * multi-megapixel pipe.
 *
 * `clientWidth` is CSS pixels: on a 2x display the engine was rendering at half
 * the panel's real resolution and the browser upscaled the result, which is what
 * made edges and surfaces look soft. Aspect ratio is preserved exactly — both
 * axes take the same scale and the same rounding floor — so the video maps 1:1
 * onto the host and never needs cropping to fit.
 */
function streamSize(host: HTMLElement, maxEdge: number): { width: number; height: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.max(host.clientWidth || 640, 320);
  const cssH = Math.max(host.clientHeight || 480, 240);
  const scale = Math.min(1, maxEdge / (Math.max(cssW, cssH) * dpr));
  // Round to a multiple of 4 — h.264 chroma subsampling wants even dimensions.
  const quantize = (edge: number) => Math.max(Math.round((edge * dpr * scale) / 4) * 4, 240);
  return { width: quantize(cssW), height: quantize(cssH) };
}

/** Margin left around the model when fitting the camera. */
const FIT_PADDING = 0.18;

function cameraCmd(view: CadView, padding = FIT_PADDING): zoo.ModelingCmd {
  if (view === "iso" || view === "orbit") {
    return { type: "view_isometric", padding };
  }
  const center = { x: 0, y: 0, z: 0 };
  const dist = 220;
  switch (view) {
    case "front":
      return {
        type: "default_camera_look_at",
        center,
        up: { x: 0, y: 0, z: 1 },
        vantage: { x: 0, y: -dist, z: 0 },
      };
    case "back":
      return {
        type: "default_camera_look_at",
        center,
        up: { x: 0, y: 0, z: 1 },
        vantage: { x: 0, y: dist, z: 0 },
      };
    case "right":
      return {
        type: "default_camera_look_at",
        center,
        up: { x: 0, y: 0, z: 1 },
        vantage: { x: dist, y: 0, z: 0 },
      };
    case "left":
      return {
        type: "default_camera_look_at",
        center,
        up: { x: 0, y: 0, z: 1 },
        vantage: { x: -dist, y: 0, z: 0 },
      };
    case "top":
      return {
        type: "default_camera_look_at",
        center,
        up: { x: 0, y: 1, z: 0 },
        vantage: { x: 0, y: 0, z: dist },
      };
    case "bottom":
      return {
        type: "default_camera_look_at",
        center,
        up: { x: 0, y: -1, z: 0 },
        vantage: { x: 0, y: 0, z: -dist },
      };
  }
}

async function sendCmd(rtc: zoo.WebRTC, cmd: zoo.ModelingCmd): Promise<unknown> {
  const req: zoo.WebSocketRequest = {
    type: "modeling_cmd_req",
    cmd_id: crypto.randomUUID(),
    cmd,
  };
  return rtc.send(zoo.modeling.modeling_commands_ws.toBSON(req));
}

/** Best-effort: name solid3d bodies from KCL bindings so hover can label them. */
async function syncSolidLabels(rtc: zoo.WebRTC, script: string): Promise<Map<string, string>> {
  const names = listCadSolids(script);
  if (names.length === 0) return new Map();
  try {
    const listed = await sendCmd(rtc, sceneGetSolidIdsCmd(Math.max(names.length, 32)));
    const ids = solidIdsFromSceneGet(listed);
    const map = pairSolidNames(script, ids);
    for (const [object_id, name] of map) {
      try {
        await sendCmd(rtc, { type: "object_set_name", object_id, name });
      } catch {
        // Naming is optional — hover still works via the local map.
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Pull a human-readable message out of Zoo's various failure shapes. */
function kclSubmitErrorMessage(result: unknown): string | null {
  if (!result || typeof result !== "object") return "KCL execution failed";
  const r = result as Record<string, unknown>;

  if (r.success === false) {
    if (Array.isArray(r.errors)) {
      const msgs = (r.errors as { message?: string }[]).map((e) => e.message).filter(Boolean);
      if (msgs.length) return msgs.join("; ");
    }
    return "KCL execution failed";
  }

  if (r.error && typeof r.error === "object") {
    const err = r.error as Record<string, unknown>;
    const details = err.details;
    if (typeof details === "string" && details.trim()) return details;
    if (details && typeof details === "object") {
      const d = details as Record<string, unknown>;
      if (typeof d.msg === "string") return d.msg;
      if (typeof d.message === "string") return d.message;
      try {
        return JSON.stringify(details);
      } catch {
        // fall through
      }
    }
    if (typeof err.message === "string") return err.message;
    if (typeof err.kind === "string") return `KCL error (${err.kind})`;
    return "KCL execution failed";
  }

  return null;
}

/** Interaction commands are fire-and-forget, so they reuse the nil id like the SDK. */
const HOT_PATH_CMD_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Navigation goes over the RTC data channel when it is up — the websocket adds
 * a round trip through the worker and makes orbiting feel laggy.
 */
function sendInteraction(rtc: zoo.WebRTC, cmd: zoo.ModelingCmd): void {
  const channel = rtc.channel;
  if (channel?.readyState === "open") {
    channel.send(JSON.stringify({ type: "modeling_cmd_req", cmd_id: HOT_PATH_CMD_ID, cmd }));
    return;
  }
  void sendCmd(rtc, cmd).catch(() => undefined);
}

/** Zoo / KittyCAD default co-ordinate system (forward −Y, up +Z). */
const ZOO_COORDS: zoo.System = {
  forward: { axis: "y", direction: "negative" },
  up: { axis: "z", direction: "positive" },
};

export type CadMeshAsset = {
  path: string;
  format: string;
  /** Authenticated URL under /api/files/… */
  fileUrl: string;
  lengthUnit?: "mm" | "cm" | "m" | "in" | "ft" | "yd";
};

function inputFormatForMesh(asset: CadMeshAsset): zoo.InputFormat3d {
  const units = asset.lengthUnit ?? "mm";
  const fmt = asset.format.toLowerCase();
  if (fmt === "stl") return { type: "stl", coords: ZOO_COORDS, units };
  if (fmt === "obj") return { type: "obj", coords: ZOO_COORDS, units };
  if (fmt === "ply") return { type: "ply", coords: ZOO_COORDS, units };
  if (fmt === "gltf" || fmt === "glb") return { type: "gltf" };
  if (fmt === "step" || fmt === "stp" || fmt === "ste") {
    return { type: "step", coords: ZOO_COORDS };
  }
  if (fmt === "fbx") return { type: "fbx" };
  if (fmt === "sat" || fmt === "sab" || fmt === "smb" || fmt === "smt") {
    return { type: "acis", coords: ZOO_COORDS };
  }
  if (fmt === "catpart" || fmt === "catproduct") {
    return { type: "catia", coords: ZOO_COORDS };
  }
  if (fmt === "prt" || fmt === "asm" || fmt === "g" || fmt === "neu") {
    return { type: "creo" };
  }
  if (fmt === "ipt" || fmt === "iam") return { type: "inventor", coords: ZOO_COORDS };
  if (fmt === "x_t" || fmt === "x_b") return { type: "parasolid", coords: ZOO_COORDS };
  if (fmt === "sldprt") return { type: "sldprt" };
  return { type: "stl", coords: ZOO_COORDS, units };
}

async function loadMeshBytes(fileUrl: string): Promise<number[]> {
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Failed to load mesh (${res.status})`);
  const buf = await res.arrayBuffer();
  return Array.from(new Uint8Array(buf));
}

async function importMeshes(rtc: zoo.WebRTC, assets: CadMeshAsset[]): Promise<void> {
  for (const asset of assets) {
    const data = await loadMeshBytes(asset.fileUrl);
    await sendCmd(rtc, {
      type: "import_files",
      files: [{ path: asset.path, data }],
      format: inputFormatForMesh(asset),
    });
  }
}

const AUTH_TOKEN_INVALID_MSG = "The CAD service rejected its authentication token.";

/**
 * Token-only Clients leave `oauth2` undefined. @kittycad/lib WebRTC still calls
 * `client.oauth2.fetchAuthorizationCode()` when the engine returns
 * auth_token_invalid — same stub pattern as KittyCAD/viewer.
 *
 * Only those two members are ever reached, so the stub is cast instead of
 * implementing the whole OAuth2AuthCodePKCE surface.
 */
function ensureTokenAuthClient(client: zoo.Client, onAuthFailure: () => void): zoo.Client {
  if (client.oauth2) return client;
  client.oauth2 = {
    getAccessToken: async () => (client.token ? { token: { value: client.token } } : undefined),
    fetchAuthorizationCode: async () => {
      onAuthFailure();
    },
  } as unknown as NonNullable<zoo.Client["oauth2"]>;
  return client;
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
      className={cn(active && "bg-primary/15 text-primary", "text-primary", className)}
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
                "absolute inset-0 flex items-center justify-center border text-[9px] font-semibold tracking-wider transition-colors",
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
      <div className="bg-card/90 flex items-center gap-2 rounded-md border px-1.5 py-0.5 shadow-sm backdrop-blur-md">
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
            "text-muted-foreground hover:text-primary rounded px-1 text-[9px] font-semibold disabled:opacity-40",
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
                  transform: `rotate(${projected.angleDeg}deg) scale(${0.75 + projected.scale * 0.25})`,
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

export function CadViewport({
  script,
  engine,
  view = "orbit",
  chrome = true,
  headless = false,
  meshAssets = [],
  foreignImportOnly = false,
  projectFiles,
  entryPath,
  fitPadding = FIT_PADDING,
  scenery = true,
  onReady,
  onError,
  onCameraOrientationChange,
}: {
  script: string;
  engine: EngineSession;
  view?: CadView;
  /** Editor chrome (toolbar / view cube). */
  chrome?: boolean;
  /**
   * Thumbnail / capture mode: lock a fixed camera after first paint.
   * Independent of `chrome` so interactive scenes can hide the toolbar
   * without getting the screenshot camera path.
   */
  headless?: boolean;
  /** Margin around the model when framing. Tighten for thumbnails. */
  fitPadding?: number;
  /** Ground grid and axes gizmo. Off for a clean product shot. */
  scenery?: boolean;
  /** Foreign mesh files to load via Zoo `import_files` (browser can't resolve KCL imports). */
  meshAssets?: CadMeshAsset[];
  /** Skip KCL submit and only import meshes (import-only stub scripts). */
  foreignImportOnly?: boolean;
  /** Multi-file KCL project (path → source). Enables `import "parts/….kcl"`. */
  projectFiles?: Record<string, string>;
  /** Entrypoint path inside projectFiles (e.g. assembly/product.kcl). */
  entryPath?: string;
  onReady?: () => void;
  onError?: (message: string | null) => void;
  onCameraOrientationChange?: (orientation: CameraOrientation) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rtcRef = useRef<zoo.WebRTC | null>(null);
  const scriptRef = useRef(script);
  const meshAssetsRef = useRef(meshAssets);
  const foreignImportOnlyRef = useRef(foreignImportOnly);
  const projectFilesRef = useRef(projectFiles);
  const entryPathRef = useRef(entryPath);
  meshAssetsRef.current = meshAssets;
  foreignImportOnlyRef.current = foreignImportOnly;
  projectFilesRef.current = projectFiles;
  entryPathRef.current = entryPath;
  const initialViewRef = useRef(view);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onCameraOrientationChangeRef = useRef(onCameraOrientationChange);
  const execGenRef = useRef(0);
  const framedOnceRef = useRef(false);
  const navToolRef = useRef<NavTool>("select");
  scriptRef.current = script;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  onCameraOrientationChangeRef.current = onCameraOrientationChange;

  const [status, setStatus] = useState<ViewportStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [rtcReady, setRtcReady] = useState(false);
  const [hoverLabel, setHoverLabel] = useState<{ name: string; x: number; y: number } | null>(null);
  const solidNamesRef = useRef<Map<string, string>>(new Map());
  const labelCacheRef = useRef<Map<string, string | null>>(new Map());
  const hoverSeqRef = useRef(0);
  const streamSizeRef = useRef({ width: 640, height: 480 });
  const [activeView, setActiveView] = useState<StandardView | null>(
    view === "orbit" ? "iso" : (view as StandardView),
  );
  const [cameraOrientation, setCameraOrientation] = useState<CameraOrientation>(() =>
    orientationForView(view === "orbit" ? "iso" : view),
  );
  // Select by default: dragging orbits regardless of tool, so starting in
  // orbit-only mode just meant clicks never picked anything.
  const [navTool, setNavTool] = useState<NavTool>("select");
  const [projection, setProjection] = useState<Projection>("perspective");
  const [edges, setEdges] = useState(true);
  const [axes, setAxes] = useState(true);
  const ready = status === "running";
  // Camera/view/display commands only need the live RTC session — gating them
  // on a successful KCL execution left the whole toolbar dead whenever a model
  // was slow or failed, with no way to even orbit or fit.
  const controlsReady = rtcReady;
  navToolRef.current = navTool;

  const runCmd = useCallback(async (cmd: zoo.ModelingCmd) => {
    const rtc = rtcRef.current;
    if (!rtc) return false;
    try {
      await sendCmd(rtc, cmd);
      return true;
    } catch {
      console.warn("A CAD viewport command could not be completed.");
      return false;
    }
  }, []);

  const applyView = useCallback(
    async (next: CadView) => {
      const standard = next === "orbit" ? "iso" : next;
      const applied = await runCmd(cameraCmd(next, fitPadding));
      if (!applied) return;
      await runCmd({ type: "zoom_to_fit", padding: fitPadding, animated: false });
      const orientation = orientationForView(standard);
      setActiveView(standard);
      setCameraOrientation(orientation);
      onCameraOrientationChangeRef.current?.(orientation);
    },
    [runCmd, fitPadding],
  );

  const fit = useCallback(async () => {
    await runCmd({ type: "zoom_to_fit", padding: fitPadding });
  }, [runCmd, fitPadding]);

  const setNav = useCallback(
    async (tool: NavTool) => {
      setNavTool(tool);
      if (tool !== "select") setHoverLabel(null);
      await runCmd({
        type: "set_tool",
        tool: tool === "orbit" ? "camera_revolve" : "select",
      });
    },
    [runCmd],
  );

  const toggleProjection = useCallback(async () => {
    const next: Projection = projection === "perspective" ? "orthographic" : "perspective";
    setProjection(next);
    await runCmd(
      next === "orthographic"
        ? { type: "default_camera_set_orthographic" }
        : { type: "default_camera_set_perspective" },
    );
  }, [projection, runCmd]);

  const toggleEdges = useCallback(async () => {
    const next = !edges;
    setEdges(next);
    await runCmd({ type: "edge_lines_visible", hidden: !next });
  }, [edges, runCmd]);

  const toggleAxes = useCallback(async () => {
    const next = !axes;
    setAxes(next);
    await runCmd({ type: "make_axes_gizmo", clobber: true, gizmo_mode: next });
  }, [axes, runCmd]);

  const zoom = useCallback(
    async (magnitude: number) => {
      await runCmd({ type: "default_camera_zoom", magnitude });
    },
    [runCmd],
  );

  const captureView = useCallback(() => {
    const video = hostRef.current?.querySelector("video");
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `foundry-view-${activeView ?? "orbit"}.png`;
    a.click();
  }, [activeView]);

  // Open one WebRTC session per token — script edits must not reconnect.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let rtc: zoo.WebRTC | null = null;
    let authPoll: ReturnType<typeof setInterval> | null = null;
    let input: ViewportInput | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    setRtcReady(false);
    framedOnceRef.current = false;
    solidNamesRef.current = new Map();
    labelCacheRef.current = new Map();
    setHoverLabel(null);
    setStatus("connecting");
    setError(null);
    onErrorRef.current?.(null);
    rtcRef.current = null;

    const token = engine.token?.trim();
    if (!token) {
      setStatus("error");
      const message = safeCadError(new Error("CAD service token is empty"), "session");
      setError(message);
      onErrorRef.current?.(message);
      onReadyRef.current?.();
      return;
    }

    let authFailed = false;
    const client = ensureTokenAuthClient(
      new zoo.Client({
        token,
        baseUrl: engine.baseUrl ?? "https://api.zoo.dev",
      }),
      () => {
        authFailed = true;
        rtc?.deconstructor();
      },
    );

    // Headless capture downscales anyway, so only the interactive viewport pays
    // for the extra pixels a 2x display needs.
    const maxEdge = headless ? 1440 : 2200;
    const size = streamSize(host, maxEdge);
    streamSizeRef.current = size;
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:100%;height:100%;background:#1c222e";
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    // `contain`, not `cover`: the stream now matches the host's aspect ratio, and
    // cropping a CAD view to fill would silently cut geometry off the edges.
    video.style.cssText = "width:100%;height:100%;object-fit:contain;background:#1c222e";
    wrap.appendChild(video);
    host.replaceChildren(wrap);

    rtc = new zoo.WebRTC({
      client,
      video_res_width: size.width,
      video_res_height: size.height,
      fps: 30,
      unlocked_framerate: true,
      post_effect: "ssao",
      show_grid: scenery,
      order_independent_transparency: true,
      webrtc: true,
    });

    const connect = async () => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          if (authPoll) clearInterval(authPoll);
          reject(
            new Error(authFailed ? AUTH_TOKEN_INVALID_MSG : "CAD engine connection timed out"),
          );
        }, 45_000);
        const finish = (fn: () => void) => {
          clearTimeout(t);
          if (authPoll) clearInterval(authPoll);
          authPoll = null;
          fn();
        };
        authPoll = setInterval(() => {
          if (!authFailed) return;
          finish(() => reject(new Error(AUTH_TOKEN_INVALID_MSG)));
        }, 100);
        rtc!.addEventListener(
          "track",
          (event) => {
            if (!(event.target instanceof zoo.WebRTC)) return;
            video.srcObject = event.target.track?.streams[0] ?? null;
          },
          { once: true },
        );
        rtc!.addEventListener(
          "connected",
          () => {
            void video.play().catch(() => undefined);
            finish(() => resolve());
          },
          { once: true },
        );
        void rtc!.start();
      });

      if (cancelled || !rtc) return;
      rtcRef.current = rtc;
      setRtcReady(true);
    };

    // The engine's window coordinate space, kept in sync with reconfigures.
    let streamed = size;

    const session = rtc;
    input = attachViewportInput({
      video,
      send: (cmd) => sendInteraction(session, cmd),
      getTool: () => navToolRef.current,
      getStreamSize: () => streamed,
      objectFit: "contain",
      onCameraDrag: (interaction, deltaX, deltaY) => {
        if (interaction !== "rotate" && interaction !== "rotatetrackball") return;
        setActiveView(null);
        setCameraOrientation((current) => {
          const next = cameraOrientationAfterDrag(current, interaction, deltaX, deltaY);
          onCameraOrientationChangeRef.current?.(next);
          return next;
        });
      },
    });

    // Without this the stream keeps its connect-time resolution: the picture
    // goes soft and pointer coordinates drift out of sync with the render.
    resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (cancelled || !rtcRef.current) return;
        const next = streamSize(host, maxEdge);
        if (next.width === streamed.width && next.height === streamed.height) return;
        streamed = next;
        streamSizeRef.current = next;
        video.width = next.width;
        video.height = next.height;
        rtcRef.current.resize(next);
      }, 180);
    });
    resizeObserver.observe(host);

    void connect().catch((err) => {
      if (cancelled) return;
      const message = safeCadError(err, "connection");
      setStatus("error");
      setError(message);
      onErrorRef.current?.(message);
      onReadyRef.current?.();
    });

    return () => {
      cancelled = true;
      if (authPoll) clearInterval(authPoll);
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      input?.detach();
      setRtcReady(false);
      rtcRef.current = null;
      rtc?.deconstructor();
      host.replaceChildren();
    };
  }, [engine.token, engine.baseUrl, headless, scenery]);

  // Re-execute KCL on the live session (params / autosave must not reconnect).
  useEffect(() => {
    if (!rtcReady) return;
    const rtc = rtcRef.current;
    if (!rtc) return;

    const gen = ++execGenRef.current;
    let cancelled = false;
    const startView = initialViewRef.current;
    const kcl = scriptRef.current;

    const run = async () => {
      setStatus("executing");
      setError(null);
      onErrorRef.current?.(null);

      try {
        await sendCmd(rtc, { type: "scene_clear_all" });
      } catch {
        // First paint may not need clear; ignore.
      }
      if (cancelled || gen !== execGenRef.current) return;

      const meshes = meshAssetsRef.current;
      const importOnly = foreignImportOnlyRef.current && meshes.length > 0;

      if (importOnly) {
        try {
          await importMeshes(rtc, meshes);
        } catch (err) {
          if (cancelled || gen !== execGenRef.current) return;
          const message = safeCadError(err, "import");
          setStatus("error");
          setError(message);
          onErrorRef.current?.(message);
          onReadyRef.current?.();
          return;
        }
      } else {
        const files = projectFilesRef.current;
        const entry = entryPathRef.current;
        const useProject = Boolean(files && entry && Object.keys(files).length > 0);
        let submitResult: unknown;
        if (useProject) {
          const project = new Map(Object.entries(files!));
          // Runtime accepts Map<path, source>; typings only list string.
          submitResult = await (
            rtc.executor().submit as (
              input: string | Map<string, string>,
              opts?: { mainKclPathName: string },
            ) => Promise<unknown>
          )(project, { mainKclPathName: entry! });
        } else {
          submitResult = await rtc.executor().submit(kcl);
        }
        if (cancelled || gen !== execGenRef.current) return;

        const failMessage = kclSubmitErrorMessage(submitResult);
        if (failMessage) {
          const message = safeCadError(failMessage, "execution");
          setStatus("error");
          setError(message);
          onErrorRef.current?.(message);
          onReadyRef.current?.();
          return;
        }

        // Best-effort meshes when viewing a single foreign-import part (not assembly proxies).
        if (meshes.length > 0 && !useProject) {
          try {
            await importMeshes(rtc, meshes);
          } catch {
            // Parametric KCL already rendered; mesh attach is optional.
          }
        }
      }

      try {
        if (!framedOnceRef.current) {
          if (scenery) {
            await sendCmd(rtc, { type: "make_axes_gizmo", clobber: true, gizmo_mode: true });
          }
          await sendCmd(rtc, { type: "edge_lines_visible", hidden: false });
          // Camera drags are tool-independent, so the scene tool only needs to
          // decide whether clicks pick entities.
          await sendCmd(rtc, {
            type: "set_tool",
            tool: navToolRef.current === "orbit" ? "camera_revolve" : "select",
          });
          await sendCmd(rtc, cameraCmd(startView, fitPadding));
          await sendCmd(rtc, { type: "zoom_to_fit", padding: fitPadding });
          await new Promise((r) => setTimeout(r, 200));
          if (!cancelled && gen === execGenRef.current && rtcRef.current) {
            await sendCmd(rtc, { type: "zoom_to_fit", padding: fitPadding });
          }
          framedOnceRef.current = true;
        }
        // Later re-executes keep the current camera so orbit/pan aren't yanked.
      } catch {
        // Framing / display setup is best-effort.
      }

      if (cancelled || gen !== execGenRef.current) return;

      // Name solids for hover labels (manufacturing/preview named bindings).
      if (!importOnly && !headless) {
        const labeled = await syncSolidLabels(rtc, scriptRef.current);
        if (cancelled || gen !== execGenRef.current) return;
        solidNamesRef.current = labeled;
        labelCacheRef.current = new Map();
      }

      setStatus("running");
      setTimeout(() => {
        if (!cancelled && gen === execGenRef.current) onReadyRef.current?.();
      }, 500);
    };

    void run().catch((err) => {
      if (cancelled || gen !== execGenRef.current) return;
      const message = safeCadError(err, "execution");
      setStatus("error");
      setError(message);
      onErrorRef.current?.(message);
      onReadyRef.current?.();
    });

    return () => {
      cancelled = true;
    };
  }, [
    script,
    rtcReady,
    foreignImportOnly,
    entryPath,
    meshAssets.map((a) => a.fileUrl).join("|"),
    projectFiles
      ? Object.keys(projectFiles).sort().join("|") + Object.values(projectFiles).join("\0").length
      : "",
  ]);

  // Thumbnail / capture pages: lock a fixed camera after first successful paint.
  useEffect(() => {
    if (!headless || !ready) return;
    void applyView(view);
  }, [headless, ready, view, applyView]);

  // Hover label: throttle highlight queries and resolve solid names under the cursor.
  useEffect(() => {
    if (headless || !ready) {
      setHoverLabel(null);
      return;
    }
    const host = hostRef.current;
    const video = host?.querySelector("video");
    if (!host || !video) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: { clientX: number; clientY: number; offsetX: number; offsetY: number } | null =
      null;

    const clearLabel = () => {
      hoverSeqRef.current += 1;
      setHoverLabel(null);
    };

    const probe = () => {
      timer = null;
      const p = pending;
      pending = null;
      if (!p || navToolRef.current !== "select") {
        clearLabel();
        return;
      }
      const rtc = rtcRef.current;
      if (!rtc) return;

      const point = toStreamPoint(
        p.offsetX,
        p.offsetY,
        { width: video.clientWidth, height: video.clientHeight },
        streamSizeRef.current,
        "contain",
      );
      const seq = ++hoverSeqRef.current;
      const localX = p.clientX - host.getBoundingClientRect().left;
      const localY = p.clientY - host.getBoundingClientRect().top;

      void (async () => {
        try {
          const result = await sendCmd(rtc, {
            type: "highlight_set_entity",
            selected_at_window: point,
            sequence: seq,
          });
          if (seq !== hoverSeqRef.current) return;
          const entityId = entityIdFromHighlight(result);
          if (!entityId) {
            setHoverLabel(null);
            return;
          }
          const name = await resolveHoverLabel(
            entityId,
            solidNamesRef.current,
            (cmd) => sendCmd(rtc, cmd),
            labelCacheRef.current,
          );
          if (seq !== hoverSeqRef.current) return;
          if (!name) {
            setHoverLabel(null);
            return;
          }
          setHoverLabel({ name, x: localX, y: localY });
        } catch {
          if (seq === hoverSeqRef.current) setHoverLabel(null);
        }
      })();
    };

    const onMove = (e: PointerEvent) => {
      if (navToolRef.current !== "select") {
        clearLabel();
        return;
      }
      pending = {
        clientX: e.clientX,
        clientY: e.clientY,
        offsetX: e.offsetX,
        offsetY: e.offsetY,
      };
      // Follow the cursor immediately so the chip doesn't lag the pointer.
      setHoverLabel((prev) =>
        prev
          ? {
              ...prev,
              x: e.clientX - host.getBoundingClientRect().left,
              y: e.clientY - host.getBoundingClientRect().top,
            }
          : prev,
      );
      if (!timer) timer = setTimeout(probe, 70);
    };

    const onLeave = () => {
      pending = null;
      if (timer) clearTimeout(timer);
      timer = null;
      clearLabel();
    };

    video.addEventListener("pointermove", onMove);
    video.addEventListener("pointerleave", onLeave);
    return () => {
      video.removeEventListener("pointermove", onMove);
      video.removeEventListener("pointerleave", onLeave);
      if (timer) clearTimeout(timer);
      clearLabel();
    };
  }, [headless, ready]);

  return (
    <div className="bg-muted/30 absolute inset-0">
      <div
        ref={hostRef}
        className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
      />
      {hoverLabel && !headless ? (
        <div
          className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-none border bg-card/95 px-2 py-1 font-mono text-[11px] font-medium shadow-lg backdrop-blur-md"
          style={{ left: hoverLabel.x, top: hoverLabel.y }}
        >
          {hoverLabel.name}
        </div>
      ) : null}

      {chrome ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-14 z-20 flex justify-center px-3 pb-3">
            <div className="bg-card/95 pointer-events-auto flex max-w-[min(100%,920px)] items-center gap-0.5 overflow-x-auto rounded-xl border px-1.5 py-1 shadow-lg backdrop-blur-md">
              <ToolbarBtn
                title="Orbit"
                active={navTool === "orbit"}
                disabled={!controlsReady}
                onClick={() => void setNav("orbit")}
              >
                <Move className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Select"
                active={navTool === "select"}
                disabled={!controlsReady}
                onClick={() => void setNav("select")}
              >
                <BoxSelect className="size-3.5" />
              </ToolbarBtn>
              <Divider />
              <ToolbarBtn
                title="Isometric view"
                active={activeView === "iso"}
                disabled={!controlsReady}
                onClick={() => void applyView("iso")}
                className="min-w-8 px-1 text-[9px] font-semibold"
              >
                ISO
              </ToolbarBtn>
              <Divider />
              <ToolbarBtn title="Fit all" disabled={!controlsReady} onClick={() => void fit()}>
                <Maximize2 className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Zoom in"
                disabled={!controlsReady}
                onClick={() => void zoom(ZOOM_BUTTON_STEP)}
              >
                <Focus className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Zoom out"
                disabled={!controlsReady}
                onClick={() => void zoom(-ZOOM_BUTTON_STEP)}
              >
                <ZoomOut className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title={
                  projection === "perspective"
                    ? "Orthographic projection"
                    : "Perspective projection"
                }
                active={projection === "orthographic"}
                disabled={!controlsReady}
                onClick={() => void toggleProjection()}
              >
                <Aperture className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Toggle edge lines"
                active={edges}
                disabled={!controlsReady}
                onClick={() => void toggleEdges()}
              >
                <Square className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Toggle axes gizmo"
                active={axes}
                disabled={!controlsReady}
                onClick={() => void toggleAxes()}
              >
                <Axis3d className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Capture PNG of current view"
                disabled={!ready}
                onClick={captureView}
              >
                <Camera className="size-3.5" />
              </ToolbarBtn>
              <span className="text-muted-foreground ml-1 hidden items-center gap-1 px-1 text-[10px] sm:inline-flex">
                <Scan className="size-3" />
                {projection === "orthographic" ? "Ortho" : "Persp"}
                {edges ? " · Edges" : ""}
              </span>
            </div>
          </div>

          <ViewCube
            active={activeView}
            orientation={cameraOrientation}
            disabled={!controlsReady}
            onSelect={(v) => void applyView(v)}
            onIso={() => void applyView("iso")}
          />

          <div className="bg-card/80 text-muted-foreground pointer-events-none absolute top-14 left-3 z-20 hidden items-center gap-2 rounded-md border px-2 py-1 text-[9px] shadow-sm backdrop-blur-md xl:flex">
            <span className="text-foreground/85 font-medium">mm · Z-up</span>
            <span className="bg-border h-3 w-px" />
            <span>Drag orbit · Shift-drag pan · Scroll zoom</span>
          </div>
        </>
      ) : null}

      {status === "error" && error ? (
        <DotMatrixLoader
          className="pointer-events-none absolute inset-0 z-10"
          tone="signal"
          label="Zoo engine error"
        >
          {error}
        </DotMatrixLoader>
      ) : status === "connecting" ? (
        <DotMatrixLoader
          className="pointer-events-none absolute inset-0 z-10"
          tone="signal"
          label="Connecting to Zoo CAD engine"
        />
      ) : status === "executing" ? (
        // The stream is already live — a full-screen loader here hid the scene
        // and blocked every control on each re-execute. Small pill instead.
        <div
          className="bg-card/95 text-muted-foreground pointer-events-none absolute top-14 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] shadow-lg backdrop-blur-md"
          role="status"
        >
          <span className="bg-primary size-1.5 animate-pulse rounded-full" />
          Building model in Zoo engine…
        </div>
      ) : null}
    </div>
  );
}
