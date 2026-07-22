"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * Circuit schematic editor. Components live on an SVG canvas; drag bodies to
 * move, click a pin then another pin to wire them, select + Delete to remove.
 * The document autosaves (debounced) and is shared with the AI copilot.
 */

type CircuitComponentType =
  | "resistor"
  | "capacitor"
  | "led"
  | "diode"
  | "ic"
  | "mcu"
  | "battery"
  | "switch"
  | "connector"
  | "sensor"
  | "ground";

type CircuitComponent = {
  id: string;
  type: CircuitComponentType;
  label: string;
  value?: string;
  x: number;
  y: number;
  rotation: number;
};

type Wire = {
  id: string;
  from: { component: string; pin: number };
  to: { component: string; pin: number };
};

export type CircuitDoc = { components: CircuitComponent[]; wires: Wire[] };

const EMPTY: CircuitDoc = { components: [], wires: [] };

const PALETTE: { type: CircuitComponentType; label: string }[] = [
  { type: "mcu", label: "MCU" },
  { type: "ic", label: "IC" },
  { type: "resistor", label: "Resistor" },
  { type: "capacitor", label: "Capacitor" },
  { type: "led", label: "LED" },
  { type: "diode", label: "Diode" },
  { type: "battery", label: "Battery" },
  { type: "switch", label: "Switch" },
  { type: "sensor", label: "Sensor" },
  { type: "connector", label: "Connector" },
  { type: "ground", label: "GND" },
];

/** Pin offsets relative to component centre (pre-rotation). */
function pinOffsets(type: CircuitComponentType): [number, number][] {
  switch (type) {
    case "ic":
    case "mcu":
      return [
        [-44, -22.5],
        [-44, -7.5],
        [-44, 7.5],
        [-44, 22.5],
        [44, -22.5],
        [44, -7.5],
        [44, 7.5],
        [44, 22.5],
      ];
    case "ground":
      return [[0, -16]];
    default:
      return [
        [-34, 0],
        [34, 0],
      ];
  }
}

function rotate([x, y]: [number, number], deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}

function pinPosition(c: CircuitComponent, pin: number): [number, number] {
  const offsets = pinOffsets(c.type);
  const off = offsets[Math.min(pin, offsets.length - 1)] ?? [0, 0];
  const [dx, dy] = rotate(off, c.rotation);
  return [c.x + dx, c.y + dy];
}

function ComponentGlyph({ c, selected }: { c: CircuitComponent; selected: boolean }) {
  const stroke = selected ? "var(--color-primary)" : "currentColor";
  const common = { stroke, strokeWidth: 1.6, fill: "none" } as const;
  switch (c.type) {
    case "resistor":
      return (
        <g {...common}>
          <line x1={-34} y1={0} x2={-18} y2={0} />
          <path d="M -18 0 L -13 -7 L -4 7 L 5 -7 L 14 7 L 18 0" />
          <line x1={18} y1={0} x2={34} y2={0} />
        </g>
      );
    case "capacitor":
      return (
        <g {...common}>
          <line x1={-34} y1={0} x2={-4} y2={0} />
          <line x1={-4} y1={-11} x2={-4} y2={11} />
          <line x1={4} y1={-11} x2={4} y2={11} />
          <line x1={4} y1={0} x2={34} y2={0} />
        </g>
      );
    case "led":
    case "diode":
      return (
        <g {...common}>
          <line x1={-34} y1={0} x2={-9} y2={0} />
          <path d="M -9 -9 L -9 9 L 9 0 Z" />
          <line x1={9} y1={-9} x2={9} y2={9} />
          <line x1={9} y1={0} x2={34} y2={0} />
          {c.type === "led" ? (
            <>
              <path d="M 0 -12 L 7 -19" />
              <path d="M 5 -10 L 12 -17" />
            </>
          ) : null}
        </g>
      );
    case "battery":
      return (
        <g {...common}>
          <line x1={-34} y1={0} x2={-6} y2={0} />
          <line x1={-6} y1={-12} x2={-6} y2={12} />
          <line x1={2} y1={-6} x2={2} y2={6} />
          <line x1={2} y1={0} x2={34} y2={0} />
        </g>
      );
    case "switch":
      return (
        <g {...common}>
          <line x1={-34} y1={0} x2={-12} y2={0} />
          <circle cx={-10} cy={0} r={2} fill={stroke} />
          <line x1={-9} y1={-1} x2={12} y2={-11} />
          <circle cx={13} cy={0} r={2} fill={stroke} />
          <line x1={15} y1={0} x2={34} y2={0} />
        </g>
      );
    case "sensor":
      return (
        <g {...common}>
          <line x1={-34} y1={0} x2={-16} y2={0} />
          <rect x={-16} y={-13} width={32} height={26} rx={4} />
          <path d="M -8 4 Q -4 -8 0 4 Q 4 -8 8 4" strokeWidth={1.2} />
          <line x1={16} y1={0} x2={34} y2={0} />
        </g>
      );
    case "connector":
      return (
        <g {...common}>
          <line x1={-34} y1={0} x2={-12} y2={0} />
          <rect x={-12} y={-10} width={24} height={20} rx={3} />
          <circle cx={-4} cy={0} r={2} fill={stroke} />
          <circle cx={4} cy={0} r={2} fill={stroke} />
          <line x1={12} y1={0} x2={34} y2={0} />
        </g>
      );
    case "ground":
      return (
        <g {...common}>
          <line x1={0} y1={-16} x2={0} y2={0} />
          <line x1={-12} y1={0} x2={12} y2={0} />
          <line x1={-8} y1={5} x2={8} y2={5} />
          <line x1={-4} y1={10} x2={4} y2={10} />
        </g>
      );
    case "ic":
    case "mcu":
      return (
        <g {...common}>
          <rect x={-36} y={-30} width={72} height={60} rx={5} />
          {pinOffsets(c.type).map(([px, py], i) => (
            <line key={i} x1={px > 0 ? 36 : -36} y1={py} x2={px} y2={py} />
          ))}
          <circle cx={-28} cy={-22} r={2.5} fill={stroke} stroke="none" />
        </g>
      );
  }
}

let nextId = 1;
function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${nextId++}`;
}

export function CircuitEditor({
  projectId,
  branchId,
  canEdit,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
}) {
  const query = trpc.design.get.useQuery({ projectId, branchId, kind: "CIRCUIT" });
  const save = trpc.design.save.useMutation();

  const [doc, setDoc] = useState<CircuitDoc>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPin, setPendingPin] = useState<{ component: string; pin: number } | null>(null);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  // Adopt server state (e.g. copilot edits) whenever we have no unsaved edits.
  useEffect(() => {
    if (!dirtyRef.current && query.data?.data) {
      setDoc(query.data.data as unknown as CircuitDoc);
    }
    if (!query.data?.data && !dirtyRef.current) setDoc(EMPTY);
  }, [query.data]);

  const scheduleSave = useCallback(
    (next: CircuitDoc) => {
      if (!canEdit) return;
      dirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        save.mutate(
          { projectId, branchId, kind: "CIRCUIT", data: next },
          { onSuccess: () => (dirtyRef.current = false) },
        );
      }, 800);
    },
    [canEdit, projectId, branchId, save],
  );

  const update = useCallback(
    (fn: (d: CircuitDoc) => CircuitDoc) => {
      setDoc((d) => {
        const next = fn(d);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  function svgPoint(e: React.PointerEvent): [number, number] {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const scaleX = 1200 / rect.width;
    const scaleY = 800 / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }

  function addComponent(type: CircuitComponentType) {
    const count = doc.components.filter((c) => c.type === type).length + 1;
    const prefix =
      type === "resistor" ? "R" : type === "capacitor" ? "C" : type === "led" ? "D" : type === "mcu" || type === "ic" ? "U" : type.slice(0, 1).toUpperCase();
    update((d) => ({
      ...d,
      components: [
        ...d.components,
        {
          id: uid(type),
          type,
          label: `${prefix}${count}`,
          x: 200 + ((d.components.length * 90) % 800),
          y: 140 + Math.floor((d.components.length * 90) / 800) * 120,
          rotation: 0,
        },
      ],
    }));
  }

  function removeSelected() {
    if (!selected) return;
    update((d) => ({
      components: d.components.filter((c) => c.id !== selected),
      wires: d.wires.filter(
        (w) => w.id !== selected && w.from.component !== selected && w.to.component !== selected,
      ),
    }));
    setSelected(null);
  }

  function onPinClick(componentId: string, pin: number) {
    if (!canEdit) return;
    if (!pendingPin) {
      setPendingPin({ component: componentId, pin });
      return;
    }
    if (pendingPin.component === componentId && pendingPin.pin === pin) {
      setPendingPin(null);
      return;
    }
    update((d) => ({
      ...d,
      wires: [...d.wires, { id: uid("w"), from: pendingPin, to: { component: componentId, pin } }],
    }));
    setPendingPin(null);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace") && selected && canEdit) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        removeSelected();
      }
      if (e.key === "Escape") setPendingPin(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, canEdit, doc]);

  const componentById = useMemo(
    () => new Map(doc.components.map((c) => [c.id, c])),
    [doc.components],
  );

  return (
    <div className="flex flex-col gap-3">
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {PALETTE.map((p) => (
            <Button key={p.type} variant="outline" size="xs" onClick={() => addComponent(p.type)}>
              {p.label}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {selected ? (
              <Button variant="destructive" size="xs" onClick={removeSelected}>
                <Trash2 className="size-3" /> Delete
              </Button>
            ) : null}
            <span className="text-muted-foreground text-xs">
              {save.isPending ? "Saving…" : pendingPin ? "Click a second pin to wire" : "Autosaves"}
            </span>
          </div>
        </div>
      ) : null}

      <div className="bg-background/60 overflow-hidden rounded-xl border">
        <svg
          ref={svgRef}
          viewBox="0 0 1200 800"
          className="text-foreground/85 block h-[calc(100vh-380px)] min-h-[420px] w-full select-none"
          onPointerDown={(e) => {
            if (e.target === svgRef.current) {
              setSelected(null);
              setPendingPin(null);
            }
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current;
            if (!drag || !canEdit) return;
            const [mx, my] = svgPoint(e);
            update((d) => ({
              ...d,
              components: d.components.map((c) =>
                c.id === drag.id
                  ? {
                      ...c,
                      x: Math.round((mx - drag.dx) / 10) * 10,
                      y: Math.round((my - drag.dy) / 10) * 10,
                    }
                  : c,
              ),
            }));
          }}
          onPointerUp={() => (dragRef.current = null)}
        >
          <defs>
            <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" className="fill-foreground/10" />
            </pattern>
          </defs>
          <rect width="1200" height="800" fill="url(#grid)" pointerEvents="none" />

          {doc.wires.map((w) => {
            const from = componentById.get(w.from.component);
            const to = componentById.get(w.to.component);
            if (!from || !to) return null;
            const [x1, y1] = pinPosition(from, w.from.pin);
            const [x2, y2] = pinPosition(to, w.to.pin);
            const midX = (x1 + x2) / 2;
            return (
              <path
                key={w.id}
                d={`M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`}
                fill="none"
                strokeWidth={selected === w.id ? 3 : 1.8}
                className={cn(
                  "cursor-pointer",
                  selected === w.id ? "stroke-primary" : "stroke-emerald-500/80",
                )}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSelected(w.id);
                }}
              />
            );
          })}

          {doc.components.map((c) => (
            <g
              key={c.id}
              transform={`translate(${c.x} ${c.y}) rotate(${c.rotation})`}
              className={canEdit ? "cursor-grab active:cursor-grabbing" : undefined}
              onPointerDown={(e) => {
                e.stopPropagation();
                setSelected(c.id);
                if (!canEdit) return;
                const [mx, my] = svgPoint(e);
                dragRef.current = { id: c.id, dx: mx - c.x, dy: my - c.y };
              }}
              onDoubleClick={() => {
                if (!canEdit) return;
                update((d) => ({
                  ...d,
                  components: d.components.map((k) =>
                    k.id === c.id ? { ...k, rotation: (k.rotation + 90) % 360 } : k,
                  ),
                }));
              }}
            >
              <ComponentGlyph c={c} selected={selected === c.id} />
              {pinOffsets(c.type).map((off, pin) => {
                const active =
                  pendingPin?.component === c.id && pendingPin.pin === pin;
                return (
                  <circle
                    key={pin}
                    cx={off[0]}
                    cy={off[1]}
                    r={active ? 6 : 4}
                    className={cn(
                      "cursor-crosshair",
                      active ? "fill-primary" : "fill-foreground/25 hover:fill-primary/70",
                    )}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onPinClick(c.id, pin);
                    }}
                  />
                );
              })}
              <text
                y={c.type === "ic" || c.type === "mcu" ? -38 : -22}
                textAnchor="middle"
                className="fill-foreground/70 text-[11px] font-medium"
                transform={`rotate(${-c.rotation})`}
              >
                {c.label}
                {c.value ? ` · ${c.value}` : ""}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="text-muted-foreground text-xs">
        Drag parts to move · click two pins to wire · double-click to rotate · Delete removes the
        selection. The copilot can draw and edit this schematic too.
      </p>
    </div>
  );
}
