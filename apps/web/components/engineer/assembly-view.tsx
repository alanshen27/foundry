"use client";

/**
 * Engineer > Assembly — the one place the whole product is visible at once.
 * Renders the mechanical assembly/parts and a SIMULATED PCB in a single Zoo
 * scene, with a summary rail linking back into each discipline's editor.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Boxes, CircuitBoard, Package, Waypoints } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CadViewport } from "@/components/engineer/cad-viewport";
import { normalizeCadDoc } from "@/lib/cad/engine";
import { buildFinalAssembly } from "@/lib/cad/final-assembly";
import { normalizePcbDoc } from "@/lib/pcb/doc";
import { formatCents } from "@/lib/format";
import { trpc } from "@/lib/trpc";

type Props = { projectId: string; branchId: string };

function SummaryRow({
  href,
  icon: Icon,
  label,
  detail,
}: {
  href: string;
  icon: typeof Boxes;
  label: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="hover:bg-muted/60 flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors"
    >
      <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
        <Icon className="size-3.5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{label}</span>
        <span className="text-muted-foreground block truncate text-[11px]">{detail}</span>
      </span>
    </Link>
  );
}

export function AssemblyView({ projectId, branchId }: Props) {
  const pathname = usePathname();
  const model = trpc.design.get.useQuery({ projectId, branchId, kind: "MODEL3D" });
  const pcb = trpc.design.get.useQuery({ projectId, branchId, kind: "PCB" });
  const engine = trpc.cad.engineSession.useQuery({ projectId });
  const components = trpc.engineer.listComponents.useQuery({ projectId, branchId });
  const [error, setError] = useState<string | null>(null);

  const loading = model.isLoading || pcb.isLoading || engine.isLoading;

  const cadDoc = useMemo(
    () => (model.data?.data ? normalizeCadDoc(model.data.data) : null),
    [model.data],
  );
  const pcbDoc = useMemo(
    () => (pcb.data?.data ? normalizePcbDoc(pcb.data.data) : null),
    [pcb.data],
  );
  const assembly = useMemo(() => buildFinalAssembly(cadDoc, pcbDoc), [cadDoc, pcbDoc]);

  const bomCents = (components.data ?? []).reduce(
    (sum, c) => sum + (c.unitCostCents ?? 0) * c.quantity,
    0,
  );

  if (loading) {
    return (
      <div className="absolute inset-0 flex" aria-busy="true">
        <Skeleton className="min-w-0 flex-1 rounded-none" />
        <Skeleton className="hidden w-64 rounded-none border-l md:block" />
      </div>
    );
  }

  if (!engine.data?.token) {
    return (
      <div className="text-destructive flex h-full items-center justify-center p-8 text-sm">
        ZOO_API_TOKEN is not configured on the server.
      </div>
    );
  }

  if (!assembly) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <Boxes className="text-muted-foreground mx-auto size-8" strokeWidth={1.5} />
          <h2 className="mt-3 text-lg font-semibold">Nothing to assemble yet</h2>
          <p className="text-muted-foreground mt-1.5 text-sm">
            The final assembly combines your mechanical parts and PCB into one scene. Start a{" "}
            <Link href={`${pathname}?view=model`} className="text-primary underline">
              model
            </Link>{" "}
            or lay out a{" "}
            <Link href={`${pathname}?view=pcb`} className="text-primary underline">
              PCB
            </Link>{" "}
            and it will show up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <CadViewport
        script={assembly.script}
        engine={{ token: engine.data.token, baseUrl: engine.data.baseUrl }}
        projectFiles={assembly.projectFiles}
        entryPath={assembly.entryPath}
        meshAssets={assembly.meshAssets}
        onError={setError}
      />
      {error ? (
        <div className="text-destructive bg-background/90 absolute inset-x-0 top-0 z-10 p-3 font-mono text-xs">
          Assembly error: {error}
        </div>
      ) : null}

      <div className="bg-card/85 absolute top-3 right-3 z-10 w-64 rounded-xl border shadow-lg backdrop-blur-md">
        <div className="border-b px-3 py-2.5">
          <p className="text-xs font-semibold">Final assembly</p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            Everything in one scene — jump into any surface to change it.
          </p>
        </div>
        <div className="flex flex-col gap-0.5 p-1.5">
          <SummaryRow
            href={`${pathname}?view=model`}
            icon={Boxes}
            label="Mechanical"
            detail={
              assembly.mechanicalRoots.length > 0
                ? assembly.mechanicalRoots.join(", ")
                : "No parts yet — open the model editor"
            }
          />
          <SummaryRow
            href={`${pathname}?view=pcb`}
            icon={CircuitBoard}
            label="PCB"
            detail={
              assembly.hasPcb && pcbDoc
                ? `${pcbDoc.board.widthMm} × ${pcbDoc.board.heightMm} mm · ${pcbDoc.footprints.length} placement${pcbDoc.footprints.length === 1 ? "" : "s"}`
                : "No board yet — open the PCB editor"
            }
          />
          <SummaryRow
            href={`${pathname}?view=schematic`}
            icon={Waypoints}
            label="Schematic"
            detail="Circuit behind the board"
          />
          <SummaryRow
            href={`${pathname}?view=sourcing`}
            icon={Package}
            label="Sourcing"
            detail={`Est. unit cost ${formatCents(bomCents)}`}
          />
        </div>
      </div>

      <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
        <span className="bg-card/85 text-muted-foreground rounded-lg border px-2.5 py-1 text-[11px] shadow backdrop-blur-md">
          SIMULATED placement — PCB position is approximate, edit parts in their editors
        </span>
      </div>
    </div>
  );
}
