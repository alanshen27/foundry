"use client";

/**
 * React Flow node renderers for circuit parts, shared by the editable canvas
 * and the readonly render page (used for copilot screenshots).
 */
import { useEffect, useRef, useState } from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
// Registers all <wokwi-*> custom elements (client-only modules import this).
import "@wokwi/elements";
import { catalogEntry, type CircuitDoc } from "@/lib/circuit/catalog";
import { cn } from "@/lib/utils";

type ElementPin = { name: string; x: number; y: number };

export type PartData = {
  partType: string;
  label?: string;
  attrs?: Record<string, string>;
  rotation: number;
  canEdit: boolean;
  /** For generic (unknown/legacy) parts: pin names referenced by wires. */
  wirePins: string[];
  /**
   * Live simulation output, 0..1 — an LED's brightness, a buzzer's signal.
   * Undefined when the simulator is not running, which leaves the element in
   * its static appearance rather than forcing it off.
   */
  simValue?: number;
  /** Set when this part can be pressed or toggled during a simulation. */
  onInteract?: (partId: string) => void;
};

export type PartNode = Node<PartData, "wokwi" | "generic">;

export const WIRE_STYLE = { stroke: "oklch(0.72 0.15 160 / 0.85)", strokeWidth: 1.6 };

function handleSide(pin: ElementPin, width: number, height: number): Position {
  const dl = pin.x;
  const dr = width - pin.x;
  const dt = pin.y;
  const db = height - pin.y;
  const min = Math.min(dl, dr, dt, db);
  if (min === dt) return Position.Top;
  if (min === db) return Position.Bottom;
  if (min === dl) return Position.Left;
  return Position.Right;
}

/** A realistic Wokwi element with pin-accurate connection handles. */
function WokwiPartNode({ id, data, selected }: NodeProps<PartNode>) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const [pins, setPins] = useState<ElementPin[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 48, h: 48 });
  const updateNodeInternals = useUpdateNodeInternals();
  const attrsKey = JSON.stringify(data.attrs ?? {});

  // Handles mount only after the web component reports its pins; React Flow
  // must re-measure them or edges to this node won't render.
  useEffect(() => {
    if (pins.length > 0) updateNodeInternals(id);
  }, [pins, id, updateNodeInternals]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";
    const el = document.createElement(data.partType) as HTMLElement & {
      pinInfo?: ElementPin[];
    };
    for (const [key, value] of Object.entries(data.attrs ?? {})) {
      el.setAttribute(key, value);
    }
    host.appendChild(el);
    elRef.current = el;

    let cancelled = false;
    void customElements.whenDefined(data.partType).then(() => {
      // Wait one frame so the shadow DOM has rendered and has layout.
      requestAnimationFrame(() => {
        if (cancelled) return;
        setPins(el.pinInfo ?? []);
        setSize({ w: el.offsetWidth || 48, h: el.offsetHeight || 48 });
      });
    });
    return () => {
      cancelled = true;
    };
    // attrsKey captures attrs content; re-running on object identity would
    // rebuild the element (and flicker) on every unrelated node update.
  }, [data.partType, attrsKey]);

  /**
   * Push simulation state onto the live element. Wokwi elements expose their
   * lit/active state as properties (`value`, `hasSignal`, `pressed`), so the
   * real component does the rendering and there is no second set of visuals to
   * keep in step with it.
   */
  useEffect(() => {
    const el = elRef.current as (HTMLElement & Record<string, unknown>) | null;
    if (!el || data.simValue === undefined) return;
    const on = data.simValue > 0;
    if ("value" in el) el.value = on;
    if ("hasSignal" in el) el.hasSignal = on;
    if ("pressed" in el) el.pressed = on;
  }, [data.simValue, pins]);

  const interactive = data.onInteract;

  return (
    <div
      className={cn(
        "relative",
        selected && "rounded-none ring-2 ring-emerald-400/80",
        interactive && "cursor-pointer",
      )}
      style={{
        transform: data.rotation ? `rotate(${data.rotation}deg)` : undefined,
      }}
      onPointerDown={interactive ? () => interactive(id) : undefined}
    >
      {data.label ? (
        <div className="text-foreground/70 absolute -top-4.5 left-1/2 -translate-x-1/2 text-[10px] font-medium whitespace-nowrap">
          {data.label}
        </div>
      ) : null}
      <div ref={hostRef} className="leading-none" />
      {pins.map((pin) => (
        <Handle
          key={pin.name}
          id={pin.name}
          type="source"
          position={handleSide(pin, size.w, size.h)}
          isConnectable={data.canEdit}
          title={pin.name}
          style={{
            left: pin.x,
            top: pin.y,
            transform: "translate(-50%, -50%)",
            width: 7,
            height: 7,
            minWidth: 0,
            minHeight: 0,
            background: "oklch(0.72 0.15 160 / 0.9)",
            border: "1px solid var(--color-background)",
          }}
          className="hover:!scale-150 hover:!bg-emerald-300"
        />
      ))}
    </div>
  );
}

/**
 * Fallback node for legacy glyph parts and part types the element library
 * can't render (e.g. wokwi.com-only parts in imported diagrams). Drawn as a
 * DIP-style IC package so imported schematics still read like hardware.
 */
function GenericPartNode({ data, selected }: NodeProps<PartNode>) {
  const pins = data.wirePins.length > 0 ? data.wirePins : ["1", "2", "3", "4", "5", "6", "7", "8"];
  const left = pins.filter((_, i) => i % 2 === 0);
  const right = pins.filter((_, i) => i % 2 === 1);
  const rows = Math.max(left.length, right.length);
  const pinPitch = 15;
  const padTop = 18;
  const height = Math.max(52, rows * pinPitch + padTop + 8);
  const name = (data.label ?? data.partType.replace(/^(generic:|wokwi-)/, "")).slice(0, 18);
  const typeName = data.partType.replace(/^(generic:|wokwi-)/, "");

  const legStyle = {
    width: 9,
    height: 4,
    background: "linear-gradient(180deg, #d7d9de 0%, #9a9ea8 60%, #6d717b 100%)",
    borderRadius: 1,
  } as const;

  return (
    <div className={cn("relative", selected && "rounded-none ring-2 ring-emerald-400/80")}>
      {/* Epoxy body */}
      <div
        className="relative rounded-[5px] px-3 text-center shadow-[0_2px_6px_rgba(0,0,0,0.55)]"
        style={{
          minWidth: 108,
          height,
          background: "linear-gradient(160deg, #2e3138 0%, #1c1e23 45%, #26282e 100%)",
          border: "1px solid #0d0e11",
        }}
      >
        {/* Pin-1 notch */}
        <div
          className="absolute top-0 left-1/2 h-2 w-4 -translate-x-1/2 rounded-b-full"
          style={{ background: "#101216", borderTop: "none" }}
        />
        {/* Pin-1 dot */}
        <div className="absolute top-2 left-2 size-1.5 rounded-full bg-zinc-500/70" />
        <div
          className="flex h-full flex-col items-center justify-center gap-0.5"
          style={{ paddingTop: 4 }}
        >
          <span className="text-[10px] font-semibold tracking-wide text-zinc-200">{name}</span>
          {typeName !== name ? (
            <span className="font-mono text-[8px] tracking-wider text-zinc-500 uppercase">
              {typeName.slice(0, 20)}
            </span>
          ) : null}
        </div>
        {/* Pin name silkscreen */}
        {left.map((pin, i) => (
          <span
            key={pin}
            className="absolute left-1.5 font-mono text-[7px] text-zinc-500"
            style={{ top: padTop + i * pinPitch - 4 }}
          >
            {pin.slice(0, 6)}
          </span>
        ))}
        {right.map((pin, i) => (
          <span
            key={pin}
            className="absolute right-1.5 font-mono text-[7px] text-zinc-500"
            style={{ top: padTop + i * pinPitch - 4 }}
          >
            {pin.slice(0, 6)}
          </span>
        ))}
      </div>
      {/* Metallic legs + connection handles */}
      {left.map((pin, i) => (
        <div key={pin}>
          <div
            className="absolute"
            style={{ ...legStyle, left: -8, top: padTop + i * pinPitch - 2 }}
          />
          <Handle
            id={pin}
            type="source"
            position={Position.Left}
            isConnectable={data.canEdit}
            title={pin}
            style={{
              left: -8,
              top: padTop + i * pinPitch,
              width: 7,
              height: 7,
              minWidth: 0,
              minHeight: 0,
              background: "oklch(0.72 0.15 160 / 0.9)",
              border: "1px solid var(--color-background)",
            }}
            className="hover:!scale-150 hover:!bg-emerald-300"
          />
        </div>
      ))}
      {right.map((pin, i) => (
        <div key={pin}>
          <div
            className="absolute"
            style={{ ...legStyle, right: -8, top: padTop + i * pinPitch - 2 }}
          />
          <Handle
            id={pin}
            type="source"
            position={Position.Right}
            isConnectable={data.canEdit}
            title={pin}
            style={{
              right: -8,
              left: "auto",
              top: padTop + i * pinPitch,
              width: 7,
              height: 7,
              minWidth: 0,
              minHeight: 0,
              background: "oklch(0.72 0.15 160 / 0.9)",
              border: "1px solid var(--color-background)",
            }}
            className="hover:!scale-150 hover:!bg-emerald-300"
          />
        </div>
      ))}
    </div>
  );
}

export const circuitNodeTypes = { wokwi: WokwiPartNode, generic: GenericPartNode };

export function docToGraph(
  doc: CircuitDoc,
  canEdit: boolean,
): { nodes: PartNode[]; edges: Edge[] } {
  const wirePinsByPart = new Map<string, Set<string>>();
  for (const w of doc.wires) {
    for (const end of [w.from, w.to]) {
      if (!wirePinsByPart.has(end.part)) wirePinsByPart.set(end.part, new Set());
      wirePinsByPart.get(end.part)!.add(end.pin);
    }
  }
  return {
    nodes: doc.parts.map((p) => ({
      id: p.id,
      type: catalogEntry(p.type) ? ("wokwi" as const) : ("generic" as const),
      position: { x: p.x, y: p.y },
      data: {
        partType: p.type,
        label: p.label,
        attrs: p.attrs,
        rotation: p.rotation ?? 0,
        canEdit,
        wirePins: [...(wirePinsByPart.get(p.id) ?? [])],
      },
      draggable: canEdit,
    })),
    edges: doc.wires.map((w) => ({
      id: w.id,
      source: w.from.part,
      sourceHandle: w.from.pin,
      target: w.to.part,
      targetHandle: w.to.pin,
      label: w.label,
      data: { netLabel: w.label },
      type: "smoothstep",
      style: WIRE_STYLE,
    })),
  };
}
