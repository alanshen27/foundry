"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * Parametric 3D model editor. The product is composed from primitive parts
 * (box / cylinder / sphere, millimetre units) listed on the right; the
 * viewport is a live three.js scene. Autosaves; shared with the AI copilot.
 */

type Primitive = "box" | "cylinder" | "sphere";

type Part = {
  id: string;
  name: string;
  primitive: Primitive;
  size: number[];
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
};

export type Model3dDoc = { parts: Part[] };

const EMPTY: Model3dDoc = { parts: [] };
const MM = 0.1; // world units per mm (scene scale)

let nextId = 1;
function uid() {
  return `part-${Date.now().toString(36)}-${nextId++}`;
}

const DEFAULTS: Record<Primitive, { size: number[]; name: string }> = {
  box: { size: [60, 20, 40], name: "Body" },
  cylinder: { size: [10, 30], name: "Cylinder" },
  sphere: { size: [12], name: "Sphere" },
};

function PartMesh({
  part,
  selected,
  onSelect,
}: {
  part: Part;
  selected: boolean;
  onSelect: () => void;
}) {
  const scale = MM;
  const position: [number, number, number] = [
    part.position[0] * scale,
    part.position[1] * scale,
    part.position[2] * scale,
  ];
  const rotation: [number, number, number] = [
    (part.rotation[0] * Math.PI) / 180,
    (part.rotation[1] * Math.PI) / 180,
    (part.rotation[2] * Math.PI) / 180,
  ];
  return (
    <mesh
      position={position}
      rotation={rotation}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {part.primitive === "box" ? (
        <boxGeometry
          args={[
            (part.size[0] ?? 10) * scale,
            (part.size[1] ?? 10) * scale,
            (part.size[2] ?? 10) * scale,
          ]}
        />
      ) : part.primitive === "cylinder" ? (
        <cylinderGeometry
          args={[
            (part.size[0] ?? 10) * scale,
            (part.size[0] ?? 10) * scale,
            (part.size[1] ?? 20) * scale,
            48,
          ]}
        />
      ) : (
        <sphereGeometry args={[(part.size[0] ?? 10) * scale, 48, 32]} />
      )}
      <meshStandardMaterial
        color={part.color}
        roughness={0.45}
        metalness={0.1}
        emissive={selected ? "#f97316" : "#000000"}
        emissiveIntensity={selected ? 0.35 : 0}
      />
    </mesh>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px]">{label}</Label>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="h-7 text-xs"
      />
    </div>
  );
}

export function ModelEditor({
  projectId,
  branchId,
  canEdit,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
}) {
  const query = trpc.design.get.useQuery({ projectId, branchId, kind: "MODEL3D" });
  const save = trpc.design.save.useMutation();

  const [doc, setDoc] = useState<Model3dDoc>(EMPTY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dirtyRef.current && query.data?.data) {
      setDoc(query.data.data as unknown as Model3dDoc);
    }
    if (!query.data?.data && !dirtyRef.current) setDoc(EMPTY);
  }, [query.data]);

  const update = useCallback(
    (fn: (d: Model3dDoc) => Model3dDoc) => {
      setDoc((d) => {
        const next = fn(d);
        if (canEdit) {
          dirtyRef.current = true;
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            save.mutate(
              { projectId, branchId, kind: "MODEL3D", data: next },
              { onSuccess: () => (dirtyRef.current = false) },
            );
          }, 800);
        }
        return next;
      });
    },
    [canEdit, projectId, branchId, save],
  );

  function addPart(primitive: Primitive) {
    const d = DEFAULTS[primitive];
    update((m) => ({
      parts: [
        ...m.parts,
        {
          id: uid(),
          name: `${d.name} ${m.parts.length + 1}`,
          primitive,
          size: [...d.size],
          position: [0, (d.size[1] ?? d.size[0] ?? 10) / 2, 0],
          rotation: [0, 0, 0],
          color: "#8899aa",
        },
      ],
    }));
  }

  const selected = doc.parts.find((p) => p.id === selectedId) ?? null;

  function patchSelected(patch: Partial<Part>) {
    if (!selected) return;
    update((m) => ({
      parts: m.parts.map((p) => (p.id === selected.id ? { ...p, ...patch } : p)),
    }));
  }

  const sizeLabels =
    selected?.primitive === "box"
      ? ["W (mm)", "H (mm)", "D (mm)"]
      : selected?.primitive === "cylinder"
        ? ["R (mm)", "H (mm)"]
        : ["R (mm)"];

  return (
    <div className="flex flex-col gap-3">
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="xs" onClick={() => addPart("box")}>
            + Box
          </Button>
          <Button variant="outline" size="xs" onClick={() => addPart("cylinder")}>
            + Cylinder
          </Button>
          <Button variant="outline" size="xs" onClick={() => addPart("sphere")}>
            + Sphere
          </Button>
          <span className="text-muted-foreground ml-auto text-xs">
            {save.isPending ? "Saving…" : "Autosaves · mm units"}
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_240px]">
        <div className="bg-background/60 overflow-hidden rounded-xl border">
          <Canvas
            camera={{ position: [9, 7, 9], fov: 40 }}
            className="h-[calc(100vh-380px)]! min-h-[420px]!"
            onPointerMissed={() => setSelectedId(null)}
          >
            <ambientLight intensity={0.7} />
            <directionalLight position={[8, 12, 6]} intensity={1.2} />
            <directionalLight position={[-6, 4, -8]} intensity={0.4} />
            {doc.parts.map((p) => (
              <PartMesh
                key={p.id}
                part={p}
                selected={p.id === selectedId}
                onSelect={() => setSelectedId(p.id)}
              />
            ))}
            <Grid
              args={[40, 40]}
              cellColor="#333"
              sectionColor="#444"
              fadeDistance={30}
              position={[0, 0, 0]}
            />
            <OrbitControls makeDefault enableDamping />
          </Canvas>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
            Parts
          </p>
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {doc.parts.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No parts yet. Add a primitive or ask the copilot to model the product.
              </p>
            ) : (
              doc.parts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                    p.id === selectedId
                      ? "border-primary/50 bg-primary/10"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-muted-foreground">{p.primitive}</span>
                </button>
              ))
            )}
          </div>

          {selected ? (
            <div className="mt-2 flex flex-col gap-2 rounded-lg border p-2.5">
              <Input
                value={selected.name}
                onChange={(e) => patchSelected({ name: e.target.value })}
                disabled={!canEdit}
                className="h-7 text-xs"
                aria-label="Part name"
              />
              <div className="grid grid-cols-3 gap-1.5">
                {sizeLabels.map((label, i) => (
                  <NumberField
                    key={label}
                    label={label}
                    value={selected.size[i] ?? 0}
                    disabled={!canEdit}
                    onChange={(v) => {
                      const size = [...selected.size];
                      size[i] = Math.max(0.5, v);
                      patchSelected({ size });
                    }}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(["X", "Y", "Z"] as const).map((axis, i) => (
                  <NumberField
                    key={axis}
                    label={`${axis} (mm)`}
                    value={selected.position[i] ?? 0}
                    disabled={!canEdit}
                    onChange={(v) => {
                      const position = [...selected.position] as [number, number, number];
                      position[i] = v;
                      patchSelected({ position });
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={selected.color}
                  onChange={(e) => patchSelected({ color: e.target.value })}
                  disabled={!canEdit}
                  aria-label="Part color"
                  className="h-7 w-9 cursor-pointer rounded border bg-transparent"
                />
                {canEdit ? (
                  <Button
                    variant="destructive"
                    size="xs"
                    className="ml-auto"
                    onClick={() => {
                      update((m) => ({ parts: m.parts.filter((p) => p.id !== selected.id) }));
                      setSelectedId(null);
                    }}
                  >
                    <Trash2 className="size-3" /> Remove
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Orbit: drag · zoom: scroll · pan: right-drag. Click a part to edit its parameters.
      </p>
    </div>
  );
}
