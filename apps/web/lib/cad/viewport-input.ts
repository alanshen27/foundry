/**
 * Pointer/wheel navigation for the Zoo WebRTC viewport.
 *
 * `@kittycad/lib`'s built-in `addMouseEvents` only maps middle-drag (pan) and
 * right-drag (trackball); left-drag and every keyboard modifier are dropped, so
 * orbiting is impossible without a three-button mouse. It also zooms by a flat
 * `sign(deltaY) * devicePixelRatio * 50` per event at 30 Hz, which overshoots
 * wildly on trackpads. This module replaces it.
 */
import type { ModelingCmd } from "@kittycad/lib";

export type NavTool = "orbit" | "select";
export type DragInteraction = "pan" | "rotate" | "rotatetrackball" | "zoom";
export type ObjectFit = "cover" | "contain";
export type CameraOrientation = { yawDeg: number; pitchDeg: number };
export type CameraViewId = "iso" | "front" | "back" | "left" | "right" | "top" | "bottom";
export type ProjectedCadAxis = { angleDeg: number; scale: number };

export type Modifiers = { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean };
type Box = { width: number; height: number };

/** Movement below this (CSS px) counts as a click rather than a drag. */
const CLICK_SLOP_PX = 4;

const LINE_TO_PX = 16;
const PAGE_TO_PX = 800;
/** A detented wheel notch is deltaY ≈ 100, which should feel like one zoom step. */
const WHEEL_GAIN = 0.5;
/** Trackpad pinch arrives as ctrl+wheel with much smaller deltas. */
const PINCH_GAIN = 2.5;
/** Ceiling per frame so a flung wheel can't launch the camera into the void. */
const MAX_ZOOM_STEP = 120;
const ORBIT_DEGREES_PER_PIXEL = 0.35;

/** Zoom applied by the toolbar +/- buttons, matched to one wheel notch. */
export const ZOOM_BUTTON_STEP = 50;

export function orientationForView(view: CameraViewId): CameraOrientation {
  switch (view) {
    case "front":
      return { yawDeg: 0, pitchDeg: 0 };
    case "back":
      return { yawDeg: 180, pitchDeg: 0 };
    case "right":
      return { yawDeg: 90, pitchDeg: 0 };
    case "left":
      return { yawDeg: -90, pitchDeg: 0 };
    case "top":
      return { yawDeg: 0, pitchDeg: 90 };
    case "bottom":
      return { yawDeg: 0, pitchDeg: -90 };
    case "iso":
      return { yawDeg: -35, pitchDeg: 28 };
  }
}

/** Keep CSS camera-linked guides synchronized with an engine orbit drag. */
export function cameraOrientationAfterDrag(
  current: CameraOrientation,
  interaction: DragInteraction,
  deltaX: number,
  deltaY: number,
): CameraOrientation {
  if (interaction !== "rotate" && interaction !== "rotatetrackball") return current;
  const yawDeg = ((current.yawDeg + deltaX * ORBIT_DEGREES_PER_PIXEL + 180) % 360) - 180;
  const pitchDeg = Math.max(-89, Math.min(89, current.pitchDeg + deltaY * ORBIT_DEGREES_PER_PIXEL));
  return { yawDeg, pitchDeg };
}

/**
 * Project a world X/Y/Z axis into viewport space. This keeps the move gizmo
 * visually aligned with the camera while the engine view orbits.
 */
export function projectCadAxis(
  axis: "X" | "Y" | "Z",
  orientation: CameraOrientation,
): ProjectedCadAxis {
  const yaw = (orientation.yawDeg * Math.PI) / 180;
  const pitch = (orientation.pitchDeg * Math.PI) / 180;
  const vector =
    axis === "X"
      ? { x: Math.cos(yaw), y: Math.sin(yaw) * Math.sin(pitch) }
      : axis === "Y"
        ? { x: -Math.sin(yaw), y: Math.cos(yaw) * Math.sin(pitch) }
        : { x: 0, y: -Math.cos(pitch) };
  const magnitude = Math.hypot(vector.x, vector.y);
  return {
    angleDeg: (Math.atan2(vector.y, vector.x) * 180) / Math.PI,
    scale: Math.max(0.32, Math.min(1, magnitude)),
  };
}

/**
 * Button + modifier to camera interaction. Keep in sync with the on-screen
 * legend in `cad-viewport.tsx`.
 */
export function dragInteractionFor(button: number, mods: Modifiers): DragInteraction | null {
  if (button === 0) {
    // macOS turns ctrl+left into a context-menu gesture; leave it to the OS.
    if (mods.ctrl || mods.meta) return null;
    if (mods.shift) return "pan";
    if (mods.alt) return "zoom";
    return "rotate";
  }
  if (button === 1 || button === 2) return "pan";
  return null;
}

/** Normalize a wheel event to a `default_camera_zoom` magnitude. */
export function wheelZoomMagnitude(
  e: Pick<WheelEvent, "deltaY" | "deltaMode" | "ctrlKey">,
): number {
  const px =
    e.deltaMode === 1
      ? e.deltaY * LINE_TO_PX
      : e.deltaMode === 2
        ? e.deltaY * PAGE_TO_PX
        : e.deltaY;
  const magnitude = -px * (e.ctrlKey ? PINCH_GAIN : WHEEL_GAIN);
  return Math.max(-MAX_ZOOM_STEP, Math.min(MAX_ZOOM_STEP, magnitude));
}

/**
 * Map a CSS-pixel offset inside the video element to a pixel in the engine's
 * render target. The stream is capped below the panel size and letterboxed or
 * cropped by `object-fit`, so raw `offsetX`/`offsetY` (what the SDK sends) land
 * in the wrong place and make drags and picks drift.
 */
export function toStreamPoint(
  offsetX: number,
  offsetY: number,
  box: Box,
  stream: Box,
  fit: ObjectFit = "cover",
): { x: number; y: number } {
  if (stream.width <= 0 || stream.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { x: Math.round(offsetX), y: Math.round(offsetY) };
  }
  const ratioX = box.width / stream.width;
  const ratioY = box.height / stream.height;
  const scale = fit === "cover" ? Math.max(ratioX, ratioY) : Math.min(ratioX, ratioY);
  return {
    x: Math.round((offsetX - (box.width - stream.width * scale) / 2) / scale),
    y: Math.round((offsetY - (box.height - stream.height * scale) / 2) / scale),
  };
}

export type ViewportInput = { detach: () => void };

export function attachViewportInput({
  video,
  send,
  getTool,
  getStreamSize,
  objectFit = "cover",
  onCameraDrag,
}: {
  video: HTMLVideoElement;
  /** Delivers a modeling command; should prefer the RTC data channel. */
  send: (cmd: ModelingCmd) => void;
  getTool: () => NavTool;
  /**
   * The resolution the engine renders at, which defines its window coordinate
   * space. This is the size we asked for — not `videoWidth`, which is whatever
   * WebRTC negotiated and may be downscaled for bandwidth. Picking against the
   * transport resolution puts the ray through the wrong pixel.
   */
  getStreamSize?: () => Box;
  objectFit?: ObjectFit;
  onCameraDrag?: (interaction: DragInteraction, deltaX: number, deltaY: number) => void;
}): ViewportInput {
  type Drag = {
    pointerId: number;
    interaction: DragInteraction;
    button: number;
    /** False until the pointer clears CLICK_SLOP_PX, so clicks send no drag. */
    started: boolean;
    clientX: number;
    clientY: number;
    offsetX: number;
    offsetY: number;
  };

  let drag: Drag | null = null;
  let sequence = 0;
  let frame = 0;
  let pendingMove: { x: number; y: number; dragging: boolean } | null = null;
  let pendingZoom = 0;

  const streamSize = (): Box => {
    const requested = getStreamSize?.();
    if (requested && requested.width > 0 && requested.height > 0) return requested;
    return {
      width: video.videoWidth || video.clientWidth,
      height: video.videoHeight || video.clientHeight,
    };
  };

  const mapPoint = (offsetX: number, offsetY: number) =>
    toStreamPoint(
      offsetX,
      offsetY,
      { width: video.clientWidth, height: video.clientHeight },
      streamSize(),
      objectFit,
    );

  const eventPoint = (e: PointerEvent) => mapPoint(e.offsetX, e.offsetY);

  const flush = () => {
    frame = 0;
    if (pendingMove) {
      const { x, y, dragging } = pendingMove;
      pendingMove = null;
      sequence += 1;
      if (dragging && drag?.started) {
        send({
          type: "camera_drag_move",
          interaction: drag.interaction,
          sequence,
          window: { x, y },
        });
      } else if (!dragging) {
        // `highlight_set_entity` is what makes the entity under the cursor light
        // up; `mouse_move` (what the SDK sends) only updates cursor position.
        send({ type: "highlight_set_entity", sequence, selected_at_window: { x, y } });
      }
    }
    if (pendingZoom !== 0) {
      const magnitude = pendingZoom;
      pendingZoom = 0;
      send({ type: "default_camera_zoom", magnitude });
    }
  };

  // Coalesce to one command per frame; the SDK's 30 Hz interval adds latency
  // without matching the compositor.
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(flush);
  };

  const flushNow = () => {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    flush();
  };

  const setCursor = (value: string) => {
    video.style.cursor = value;
  };

  const endDrag = (e: PointerEvent, select: boolean) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const finished = drag;
    try {
      video.releasePointerCapture(e.pointerId);
    } catch {
      // Capture may already be gone (pointercancel, lostpointercapture).
    }
    const point = eventPoint(e);
    if (finished.started) {
      flushNow();
      drag = null;
      send({ type: "camera_drag_end", interaction: finished.interaction, window: point });
    } else {
      drag = null;
      if (select && finished.button === 0 && getTool() === "select") {
        send({
          type: "select_with_point",
          selected_at_window: point,
          selection_type: e.shiftKey ? "add" : "replace",
        });
      }
    }
    setCursor(getTool() === "select" ? "crosshair" : "grab");
  };

  const onPointerDown = (e: PointerEvent) => {
    const interaction = dragInteractionFor(e.button, {
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey,
      meta: e.metaKey,
    });
    if (!interaction) return;
    e.preventDefault();
    try {
      video.setPointerCapture(e.pointerId);
    } catch {
      // Capture is an optimization; dragging still works without it.
    }
    drag = {
      pointerId: e.pointerId,
      interaction,
      button: e.button,
      started: false,
      clientX: e.clientX,
      clientY: e.clientY,
      offsetX: e.offsetX,
      offsetY: e.offsetY,
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.pointerId) {
      if (!drag.started) {
        if (Math.hypot(e.clientX - drag.clientX, e.clientY - drag.clientY) < CLICK_SLOP_PX) return;
        drag.started = true;
        setCursor(drag.interaction === "pan" ? "grabbing" : "move");
        send({
          type: "camera_drag_start",
          interaction: drag.interaction,
          window: mapPoint(drag.offsetX, drag.offsetY),
        });
      }
      const deltaX = e.clientX - drag.clientX;
      const deltaY = e.clientY - drag.clientY;
      drag.clientX = e.clientX;
      drag.clientY = e.clientY;
      onCameraDrag?.(drag.interaction, deltaX, deltaY);
      pendingMove = { ...eventPoint(e), dragging: true };
      schedule();
      return;
    }
    // Hover highlighting only matters while picking.
    if (getTool() !== "select") return;
    pendingMove = { ...eventPoint(e), dragging: false };
    schedule();
  };

  const onPointerUp = (e: PointerEvent) => endDrag(e, true);
  const onPointerCancel = (e: PointerEvent) => endDrag(e, false);
  const onContextMenu = (e: Event) => e.preventDefault();

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    pendingZoom = Math.max(
      -MAX_ZOOM_STEP,
      Math.min(MAX_ZOOM_STEP, pendingZoom + wheelZoomMagnitude(e)),
    );
    schedule();
  };

  video.style.touchAction = "none";
  setCursor("grab");
  video.addEventListener("pointerdown", onPointerDown);
  video.addEventListener("pointermove", onPointerMove);
  video.addEventListener("pointerup", onPointerUp);
  video.addEventListener("pointercancel", onPointerCancel);
  video.addEventListener("lostpointercapture", onPointerCancel);
  video.addEventListener("contextmenu", onContextMenu);
  video.addEventListener("wheel", onWheel, { passive: false });

  return {
    detach() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      drag = null;
      pendingMove = null;
      pendingZoom = 0;
      video.removeEventListener("pointerdown", onPointerDown);
      video.removeEventListener("pointermove", onPointerMove);
      video.removeEventListener("pointerup", onPointerUp);
      video.removeEventListener("pointercancel", onPointerCancel);
      video.removeEventListener("lostpointercapture", onPointerCancel);
      video.removeEventListener("contextmenu", onContextMenu);
      video.removeEventListener("wheel", onWheel);
    },
  };
}
