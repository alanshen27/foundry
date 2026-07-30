"use client";

import { useRef, useState, type ButtonHTMLAttributes, type PointerEvent } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Axis = "X" | "Y" | "Z";

const AXIS_COLOR: Record<Axis, string> = {
  X: "bg-red-500",
  Y: "bg-emerald-500",
  Z: "bg-sky-500",
};

function projectedPixels(axis: Axis, dx: number, dy: number): number {
  if (axis === "X") return dx;
  if (axis === "Z") return -dy;
  return (dx - dy) / Math.SQRT2;
}

export function CadTransformGizmo({
  target,
  canEdit,
  onTranslate,
  onRotate,
}: {
  target: string;
  canEdit: boolean;
  onTranslate: (axis: Axis, distanceMm: number) => void;
  onRotate: (axis: Axis, degrees: number) => void;
}) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const previewRef = useRef(0);
  const [dragAxis, setDragAxis] = useState<Axis | null>(null);
  const [previewMm, setPreviewMm] = useState(0);

  const start = (axis: Axis, event: PointerEvent<HTMLButtonElement>) => {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { x: event.clientX, y: event.clientY };
    previewRef.current = 0;
    setDragAxis(axis);
    setPreviewMm(0);
  };

  const move = (axis: Axis, event: PointerEvent<HTMLButtonElement>) => {
    if (dragAxis !== axis || !startRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const pixels = projectedPixels(
      axis,
      event.clientX - startRef.current.x,
      event.clientY - startRef.current.y,
    );
    const next = Math.round((pixels / 6) * 2) / 2;
    previewRef.current = next;
    setPreviewMm(next);
  };

  const finish = (axis: Axis, event: PointerEvent<HTMLButtonElement>) => {
    if (dragAxis !== axis) return;
    event.preventDefault();
    event.stopPropagation();
    if (previewRef.current !== 0) onTranslate(axis, previewRef.current);
    startRef.current = null;
    previewRef.current = 0;
    setDragAxis(null);
    setPreviewMm(0);
  };

  return (
    <div
      className="pointer-events-none absolute top-1/2 left-1/2 z-20 size-0"
      role="group"
      aria-label={`Transform ${target}`}
    >
      <div className="relative -translate-x-1/2 -translate-y-1/2">
        <div className="bg-card/75 border-foreground/30 absolute -top-3 -left-3 size-6 rounded-full border shadow-md backdrop-blur-sm" />
        <AxisHandle
          axis="X"
          className="left-2 top-[-4px] w-24 origin-left"
          disabled={!canEdit}
          active={dragAxis === "X"}
          onPointerDown={(event) => start("X", event)}
          onPointerMove={(event) => move("X", event)}
          onPointerUp={(event) => finish("X", event)}
          onPointerCancel={(event) => finish("X", event)}
        />
        <AxisHandle
          axis="Z"
          className="-top-24 left-[-4px] w-24 origin-left -rotate-90"
          disabled={!canEdit}
          active={dragAxis === "Z"}
          onPointerDown={(event) => start("Z", event)}
          onPointerMove={(event) => move("Z", event)}
          onPointerUp={(event) => finish("Z", event)}
          onPointerCancel={(event) => finish("Z", event)}
        />
        <AxisHandle
          axis="Y"
          className="top-1 left-1 w-20 origin-left rotate-[135deg]"
          disabled={!canEdit}
          active={dragAxis === "Y"}
          onPointerDown={(event) => start("Y", event)}
          onPointerMove={(event) => move("Y", event)}
          onPointerUp={(event) => finish("Y", event)}
          onPointerCancel={(event) => finish("Y", event)}
        />

        {dragAxis ? (
          <span
            className="bg-card text-foreground absolute top-5 left-5 rounded-md border px-2 py-1 font-mono text-[10px] shadow"
            role="status"
            aria-live="polite"
          >
            {dragAxis} {previewMm > 0 ? "+" : ""}
            {previewMm.toFixed(1)} mm
          </span>
        ) : null}

        <div className="bg-card/90 pointer-events-auto absolute top-9 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border p-1 shadow backdrop-blur-sm">
          <span className="text-muted-foreground px-1 text-[9px] font-semibold tracking-wider">
            MOVE
          </span>
          {(["X", "Y", "Z"] as const).map((axis) => (
            <button
              key={axis}
              type="button"
              disabled={!canEdit}
              title={`Rotate 15° around ${axis}`}
              aria-label={`Rotate 15 degrees around ${axis} axis`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onRotate(axis, 15);
              }}
              className={cn(
                "hover:bg-muted flex h-6 items-center gap-0.5 rounded px-1.5 text-[9px] font-semibold disabled:opacity-40",
                axis === "X" ? "text-red-500" : axis === "Y" ? "text-emerald-500" : "text-sky-500",
              )}
            >
              <RotateCw className="size-2.5" />
              {axis}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AxisHandle({
  axis,
  className,
  active,
  ...props
}: {
  axis: Axis;
  className: string;
  active: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={`Drag ${axis} axis to move`}
      title={`Drag to move along ${axis}`}
      className={cn(
        "pointer-events-auto absolute h-2 cursor-grab touch-none rounded-full active:cursor-grabbing",
        AXIS_COLOR[axis],
        active ? "ring-background ring-2 brightness-125" : "opacity-90 hover:brightness-125",
        "after:absolute after:top-1/2 after:right-[-6px] after:-translate-y-1/2 after:border-y-[6px] after:border-y-transparent after:border-l-[10px]",
        axis === "X" && "after:border-l-red-500",
        axis === "Y" && "after:border-l-emerald-500",
        axis === "Z" && "after:border-l-sky-500",
        className,
      )}
      {...props}
    >
      <span className="bg-card text-foreground absolute top-1/2 right-1 -translate-y-1/2 rounded px-1 text-[8px] font-bold">
        {axis}
      </span>
    </button>
  );
}
