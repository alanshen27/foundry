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
  Crosshair,
  Focus,
  Home,
  Maximize2,
  Move,
  RotateCcw,
  Scan,
  Square,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ZOOM_BUTTON_STEP,
  attachViewportInput,
  type NavTool,
  type ViewportInput,
} from "@/lib/cad/viewport-input";
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

const STANDARD_VIEWS: { id: StandardView; label: string; title: string }[] = [
  { id: "iso", label: "Iso", title: "Isometric" },
  { id: "front", label: "F", title: "Front (−Y)" },
  { id: "back", label: "Bk", title: "Back (+Y)" },
  { id: "left", label: "L", title: "Left (−X)" },
  { id: "right", label: "R", title: "Right (+X)" },
  { id: "top", label: "T", title: "Top (+Z)" },
  { id: "bottom", label: "B", title: "Bottom (−Z)" },
];

function cameraCmd(view: CadView): zoo.ModelingCmd {
  if (view === "iso" || view === "orbit") {
    return { type: "view_isometric", padding: 0.18 };
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

async function sendCmd(rtc: zoo.WebRTC, cmd: zoo.ModelingCmd): Promise<void> {
  const req: zoo.WebSocketRequest = {
    type: "modeling_cmd_req",
    cmd_id: crypto.randomUUID(),
    cmd,
  };
  await rtc.send(zoo.modeling.modeling_commands_ws.toBSON(req));
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
  if (fmt === "step" || fmt === "stp") return { type: "step", coords: ZOO_COORDS };
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

const AUTH_TOKEN_INVALID_MSG =
  "Zoo rejected the API token (auth_token_invalid). Regenerate ZOO_API_TOKEN at https://zoo.dev/account and restart the dev server.";

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
      onClick={onClick}
      className={cn(active && "bg-primary/15 text-primary", className)}
    >
      {children}
    </Button>
  );
}

function Divider() {
  return <div className="bg-border mx-0.5 h-5 w-px shrink-0" />;
}

/** Clickable orthographic face map + iso — classic CAD view picker. */
function ViewCube({
  active,
  onSelect,
  disabled,
}: {
  active: StandardView | null;
  onSelect: (view: StandardView) => void;
  disabled?: boolean;
}) {
  const cell = (id: StandardView, label: string, extra?: string) => (
    <button
      type="button"
      disabled={disabled}
      title={label}
      onClick={() => onSelect(id)}
      className={cn(
        "flex items-center justify-center rounded-md border text-[10px] font-semibold transition-colors",
        "border-border/80 bg-background/90 hover:bg-primary/15 hover:text-primary disabled:opacity-40",
        active === id && "border-primary bg-primary/20 text-primary",
        extra,
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-card/95 pointer-events-auto absolute right-3 bottom-12 z-20 w-[132px] rounded-xl border p-2.5 shadow-lg backdrop-blur-md">
      <div className="text-muted-foreground mb-1.5 text-center text-[10px] font-medium tracking-wider uppercase">
        View cube
      </div>
      <div className="grid grid-cols-3 gap-1">
        <div />
        {cell("top", "Top", "h-8")}
        <div />
        {cell("left", "L", "h-8")}
        {cell("front", "Front", "h-8")}
        {cell("right", "R", "h-8")}
        <div />
        {cell("bottom", "Bot", "h-8")}
        <div />
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        {cell("back", "Back", "h-7")}
        {cell("iso", "Iso", "h-7")}
      </div>
      <div className="text-muted-foreground mt-2 flex items-center justify-center gap-2 text-[9px]">
        <span className="text-red-500">X</span>
        <span className="text-emerald-500">Y</span>
        <span className="text-sky-500">Z</span>
      </div>
    </div>
  );
}

export function CadViewport({
  script,
  engine,
  view = "orbit",
  chrome = true,
  meshAssets = [],
  foreignImportOnly = false,
  projectFiles,
  entryPath,
  onReady,
  onError,
}: {
  script: string;
  engine: EngineSession;
  view?: CadView;
  /** Editor chrome (toolbar / view cube). Off for headless screenshots. */
  chrome?: boolean;
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
  const execGenRef = useRef(0);
  const framedOnceRef = useRef(false);
  const navToolRef = useRef<NavTool>("select");
  scriptRef.current = script;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  const [status, setStatus] = useState<ViewportStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [rtcReady, setRtcReady] = useState(false);
  const [activeView, setActiveView] = useState<StandardView | null>(
    view === "orbit" ? "iso" : (view as StandardView),
  );
  // Select by default: dragging orbits regardless of tool, so starting in
  // orbit-only mode just meant clicks never picked anything.
  const [navTool, setNavTool] = useState<NavTool>("select");
  const [projection, setProjection] = useState<Projection>("perspective");
  const [edges, setEdges] = useState(true);
  const [axes, setAxes] = useState(true);
  const ready = status === "running";
  navToolRef.current = navTool;

  const runCmd = useCallback(async (cmd: zoo.ModelingCmd) => {
    const rtc = rtcRef.current;
    if (!rtc) return;
    try {
      await sendCmd(rtc, cmd);
    } catch (err) {
      console.warn("viewport command failed", err);
    }
  }, []);

  const applyView = useCallback(
    async (next: CadView) => {
      if (next !== "orbit") setActiveView(next);
      await runCmd(cameraCmd(next));
      await runCmd({ type: "zoom_to_fit", padding: 0.18 });
    },
    [runCmd],
  );

  const fit = useCallback(async () => {
    await runCmd({ type: "zoom_to_fit", padding: 0.18 });
  }, [runCmd]);

  const home = useCallback(async () => {
    setActiveView("iso");
    await runCmd({ type: "view_isometric", padding: 0.18 });
    await runCmd({ type: "zoom_to_fit", padding: 0.18 });
  }, [runCmd]);

  const setNav = useCallback(
    async (tool: NavTool) => {
      setNavTool(tool);
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
    setStatus("connecting");
    setError(null);
    onErrorRef.current?.(null);
    rtcRef.current = null;

    const token = engine.token?.trim();
    if (!token) {
      setStatus("error");
      const message = "Zoo engine token is empty — set ZOO_API_TOKEN in .env";
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
    const maxEdge = chrome ? 2200 : 1440;
    const size = streamSize(host, maxEdge);
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
      show_grid: true,
      order_independent_transparency: true,
      webrtc: true,
    });

    const connect = async () => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          if (authPoll) clearInterval(authPoll);
          reject(
            new Error(
              authFailed
                ? AUTH_TOKEN_INVALID_MSG
                : "Zoo engine connection timed out. If the console shows a WebAssembly magic-word error, the KCL WASM file is missing — run `pnpm --filter @foundry/web copy:kcl-wasm` and reload.",
            ),
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
        video.width = next.width;
        video.height = next.height;
        rtcRef.current.resize(next);
      }, 180);
    });
    resizeObserver.observe(host);

    void connect().catch((err) => {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : String(err);
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
  }, [engine.token, engine.baseUrl, chrome]);

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
          const message = err instanceof Error ? err.message : String(err);
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

        if (
          !submitResult ||
          (typeof submitResult === "object" &&
            submitResult !== null &&
            "success" in submitResult &&
            (submitResult as { success: boolean }).success === false)
        ) {
          const message =
            submitResult &&
            typeof submitResult === "object" &&
            "errors" in submitResult &&
            Array.isArray((submitResult as { errors: { message: string }[] }).errors)
              ? (submitResult as { errors: { message: string }[] }).errors
                  .map((e) => e.message)
                  .join("; ")
              : "KCL execution failed";
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
          await sendCmd(rtc, { type: "make_axes_gizmo", clobber: true, gizmo_mode: true });
          await sendCmd(rtc, { type: "edge_lines_visible", hidden: false });
          // Camera drags are tool-independent, so the scene tool only needs to
          // decide whether clicks pick entities.
          await sendCmd(rtc, {
            type: "set_tool",
            tool: navToolRef.current === "orbit" ? "camera_revolve" : "select",
          });
          await sendCmd(rtc, cameraCmd(startView));
          await sendCmd(rtc, { type: "zoom_to_fit", padding: 0.18 });
          await new Promise((r) => setTimeout(r, 200));
          if (!cancelled && gen === execGenRef.current && rtcRef.current) {
            await sendCmd(rtc, { type: "zoom_to_fit", padding: 0.18 });
          }
          framedOnceRef.current = true;
        }
        // Later re-executes keep the current camera so orbit/pan aren't yanked.
      } catch {
        // Framing / display setup is best-effort.
      }

      if (cancelled || gen !== execGenRef.current) return;
      setStatus("running");
      setTimeout(() => {
        if (!cancelled && gen === execGenRef.current) onReadyRef.current?.();
      }, 500);
    };

    void run().catch((err) => {
      if (cancelled || gen !== execGenRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
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
    projectFiles ? Object.keys(projectFiles).sort().join("|") + Object.values(projectFiles).join("\0").length : "",
  ]);

  // Headless screenshot pages: apply a fixed camera when chrome is off.
  useEffect(() => {
    if (chrome || !ready) return;
    void applyView(view);
  }, [chrome, ready, view, applyView]);

  return (
    <div className="bg-muted/30 absolute inset-0">
      <div
        ref={hostRef}
        className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
      />

      {chrome && status !== "error" ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-3 pt-3">
            <div className="bg-card/95 pointer-events-auto flex max-w-[min(100%,920px)] items-center gap-0.5 overflow-x-auto rounded-xl border px-1.5 py-1 shadow-lg backdrop-blur-md">
              <ToolbarBtn
                title="Orbit"
                active={navTool === "orbit"}
                disabled={!ready}
                onClick={() => void setNav("orbit")}
              >
                <Move className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Select"
                active={navTool === "select"}
                disabled={!ready}
                onClick={() => void setNav("select")}
              >
                <BoxSelect className="size-3.5" />
              </ToolbarBtn>
              <Divider />
              {STANDARD_VIEWS.map((v) => (
                <ToolbarBtn
                  key={v.id}
                  title={v.title}
                  active={activeView === v.id}
                  disabled={!ready}
                  onClick={() => void applyView(v.id)}
                  className="min-w-7 px-1 text-[10px] font-semibold"
                >
                  {v.label}
                </ToolbarBtn>
              ))}
              <Divider />
              <ToolbarBtn title="Fit all" disabled={!ready} onClick={() => void fit()}>
                <Maximize2 className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn title="Home / isometric" disabled={!ready} onClick={() => void home()}>
                <Home className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn title="Zoom in" disabled={!ready} onClick={() => void zoom(ZOOM_BUTTON_STEP)}>
                <Focus className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Zoom out"
                disabled={!ready}
                onClick={() => void zoom(-ZOOM_BUTTON_STEP)}
              >
                <ZoomOut className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Center on scene"
                disabled={!ready}
                onClick={() => void runCmd({ type: "default_camera_center_to_scene" })}
              >
                <Crosshair className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn title="Reset to iso" disabled={!ready} onClick={() => void applyView("iso")}>
                <RotateCcw className="size-3.5" />
              </ToolbarBtn>
              <Divider />
              <ToolbarBtn
                title={
                  projection === "perspective" ? "Orthographic projection" : "Perspective projection"
                }
                active={projection === "orthographic"}
                disabled={!ready}
                onClick={() => void toggleProjection()}
              >
                <Aperture className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Toggle edge lines"
                active={edges}
                disabled={!ready}
                onClick={() => void toggleEdges()}
              >
                <Square className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn
                title="Toggle axes gizmo"
                active={axes}
                disabled={!ready}
                onClick={() => void toggleAxes()}
              >
                <Axis3d className="size-3.5" />
              </ToolbarBtn>
              <ToolbarBtn title="Capture PNG of current view" disabled={!ready} onClick={captureView}>
                <Camera className="size-3.5" />
              </ToolbarBtn>
              <span className="text-muted-foreground ml-1 hidden items-center gap-1 px-1 text-[10px] sm:inline-flex">
                <Scan className="size-3" />
                {projection === "orthographic" ? "Ortho" : "Persp"}
                {edges ? " · Edges" : ""}
              </span>
            </div>
          </div>

          <ViewCube active={activeView} disabled={!ready} onSelect={(v) => void applyView(v)} />

          <div className="bg-card/90 text-muted-foreground pointer-events-none absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-2.5 py-1.5 text-[11px] shadow backdrop-blur-md">
            <span className="text-foreground/85 font-medium">Zoo · mm · Z-up</span>
            <span className="bg-border hidden h-3 w-px sm:block" />
            <span className="hidden sm:inline">Orbit: drag</span>
            <span className="hidden sm:inline">Pan: shift/right-drag</span>
            <span className="hidden sm:inline">Zoom: scroll or alt+drag</span>
            {navTool === "select" ? (
              <span className="hidden sm:inline">Select: click</span>
            ) : null}
          </div>
        </>
      ) : null}

      {status !== "running" ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm",
            // Keep the live stream visible while re-executing so orbit isn't blanked out.
            status === "executing" ? "bg-background/35" : "bg-background/55",
          )}
        >
          {error ? (
            <span className="text-destructive font-mono text-xs leading-relaxed">{error}</span>
          ) : (
            <span className="text-muted-foreground">
              {status === "executing"
                ? "Building model in Zoo engine…"
                : "Connecting to Zoo CAD engine…"}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
