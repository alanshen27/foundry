"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Box, CircuitBoard, CloudUpload, FileArchive, FileCode2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const CAD_IMPORT_ACCEPT =
  ".py,.kcl,.step,.stp,.ste,.brep,.stl,.obj,.gltf,.glb,.ply,.fbx,.sat,.sab,.smb,.smt,.catpart,.catproduct,.prt,.asm,.g,.neu,.ipt,.iam,.x_t,.x_b,.sldprt,.sldasm,.f3d,.cam360,.ige,.iges,.igs,.3mf,.3dm,.skp,.dwg,.dxf,.svg,.jt,.tsm,.wire,.123dx,.sch,.brd,.kicad_sch,.kicad_pcb,.kicad_pro,.kicad_prl";

export type CadImportUnit = "mm" | "cm" | "m" | "in" | "ft" | "yd";

export function CadImportDialog({
  open,
  pending,
  error,
  onClose,
  onFile,
}: {
  open: boolean;
  pending: boolean;
  error?: string | null;
  onClose: () => void;
  onFile: (file: File, unit: CadImportUnit) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [unit, setUnit] = useState<CadImportUnit>("mm");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || pending) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open, pending]);

  if (!open) return null;

  const choose = (file: File | undefined) => {
    if (file && !pending) onFile(file, unit);
    if (inputRef.current) inputRef.current.value = "";
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  };

  return (
    <div
      className="bg-background/55 absolute inset-0 z-[70] flex items-center justify-center p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cad-import-title"
      aria-describedby="cad-import-description"
    >
      <div className="bg-card w-full max-w-2xl overflow-hidden rounded-xl border shadow-2xl">
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
            <CloudUpload className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="cad-import-title" className="text-base font-semibold">
              Import into project
            </h2>
            <p id="cad-import-description" className="text-muted-foreground mt-0.5 text-xs">
              Open Python CAD, import geometry, or preserve original design sources.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            ref={closeRef}
            aria-label="Close import"
            onClick={onClose}
            disabled={pending}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-[1.25fr_.75fr]">
          <div
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
            className={cn(
              "flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed p-7 text-center transition-colors",
              dragging ? "border-primary bg-primary/10" : "border-border bg-muted/20",
            )}
          >
            <CloudUpload className="text-primary size-8" strokeWidth={1.5} />
            <p className="mt-3 text-sm font-semibold">
              {pending ? "Importing file…" : "Drop a design file here"}
            </p>
            <p className="text-muted-foreground mt-1 max-w-xs text-xs leading-relaxed">
              Python opens as editable source. STEP and BREP import as solids; STL and GLB preview
              locally. Other formats remain attached for conversion.
            </p>
            <Button
              className="mt-4"
              size="sm"
              disabled={pending}
              onClick={() => inputRef.current?.click()}
            >
              Browse files
            </Button>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept={CAD_IMPORT_ACCEPT}
              onChange={(event) => choose(event.target.files?.[0])}
            />
            <label className="mt-4 flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Unitless mesh units</span>
              <select
                value={unit}
                onChange={(event) => setUnit(event.target.value as CadImportUnit)}
                className="border-input bg-background h-7 rounded-md border px-2 text-xs"
              >
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="m">m</option>
                <option value="in">in</option>
                <option value="ft">ft</option>
                <option value="yd">yd</option>
              </select>
            </label>
            {error ? (
              <p className="text-destructive mt-3 text-[11px]" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <ImportKind
              icon={Box}
              title="3D geometry"
              detail="STEP and BREP import into Python CAD. STL and GLB display directly in the viewport."
            />
            <ImportKind
              icon={FileCode2}
              title="Native editable"
              detail="Python (.py) with build123d. Legacy KCL is preserved and needs conversion to preview."
            />
            <ImportKind
              icon={FileArchive}
              title="Preserved source"
              detail="Other CAD, mesh, drawing, and assembly formats remain attached for conversion."
            />
            <ImportKind
              icon={CircuitBoard}
              title="Electronics reference"
              detail="SCH, BRD, and KiCad project files remain attached as references."
            />
            <p className="text-muted-foreground px-1 pt-1 text-[10px] leading-relaxed">
              Proprietary feature trees stay downloadable but are not presented as decoded geometry.
              Export STEP from the source application when exact neutral geometry is required.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportKind({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Box;
  title: string;
  detail: string;
}) {
  return (
    <div className="bg-muted/25 flex gap-2.5 rounded-lg border px-3 py-2.5">
      <Icon className="text-primary mt-0.5 size-4 shrink-0" />
      <div>
        <p className="text-xs font-medium">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-[10px] leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}
