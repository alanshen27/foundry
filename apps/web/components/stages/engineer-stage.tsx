"use client";

import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BomTable, BomTableSkeleton } from "@/components/engineer/bom-table";
import { DesignPanel } from "@/components/engineer/design-panel";
import { CodeWorkspace } from "@/components/engineer/code-workspace";
import { trpc } from "@/lib/trpc";
import { formatCents } from "@/lib/format";

// Lit web components (@wokwi/elements) can't render on the server.
const CircuitCanvas = dynamic(
  () => import("@/components/engineer/circuit-canvas").then((m) => m.CircuitCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex flex-col gap-3 p-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="min-h-0 flex-1 rounded-xl" />
      </div>
    ),
  },
);

const ModelEditor = dynamic(
  () => import("@/components/engineer/model-editor").then((m) => m.ModelEditor),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex">
        <Skeleton className="hidden w-64 rounded-none border-r md:block" />
        <Skeleton className="min-w-0 flex-1 rounded-none" />
      </div>
    ),
  },
);

const PcbCanvas = dynamic(
  () => import("@/components/engineer/pcb-canvas").then((m) => m.PcbCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex">
        <Skeleton className="hidden w-64 rounded-none border-r md:block" />
        <Skeleton className="min-w-0 flex-1 rounded-none" />
        <Skeleton className="hidden w-60 rounded-none border-l md:block" />
      </div>
    ),
  },
);

export type EngineerView = "sourcing" | "schematic" | "pcb" | "model" | "code" | "design";

type Props = { projectId: string; branchId: string; canEdit: boolean; view: EngineerView };

const DISCIPLINES = [
  { key: "ELECTRONICS", label: "Electronics" },
  { key: "MECHANICAL", label: "Mechanical" },
  { key: "SOFTWARE", label: "Software & services" },
  { key: "DESIGN", label: "Design & finish" },
] as const;

function SourcingSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6 lg:p-8" aria-busy="true">
      <div className="flex items-end justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-4 w-32" />
      </div>
      {DISCIPLINES.map((d) => (
        <Card key={d.key}>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <BomTableSkeleton rows={d.key === "ELECTRONICS" ? 4 : 2} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SourcingView({ projectId, branchId, canEdit }: Omit<Props, "view">) {
  const components = trpc.engineer.listComponents.useQuery({ projectId, branchId });
  const rows = components.data ?? [];
  const bomCents = rows.reduce((sum, c) => sum + (c.unitCostCents ?? 0) * c.quantity, 0);

  if (components.isLoading) {
    return <SourcingSkeleton />;
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6 lg:p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sourcing</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Bill of materials across every discipline.
          </p>
        </div>
        <p className="text-muted-foreground text-sm">
          Est. unit cost{" "}
          <span className="text-foreground font-semibold tabular-nums">
            {formatCents(bomCents)}
          </span>
        </p>
      </div>
      {DISCIPLINES.map((d) => (
        <Card key={d.key}>
          <CardHeader>
            <CardTitle className="text-base">{d.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <BomTable
              projectId={projectId}
              branchId={branchId}
              canEdit={canEdit}
              discipline={d.key}
              components={rows.filter((c) => c.discipline === d.key)}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DesignView({ projectId, branchId, canEdit }: Omit<Props, "view">) {
  const components = trpc.engineer.listComponents.useQuery({ projectId, branchId });
  const design = trpc.design.get.useQuery({ projectId, branchId, kind: "DESIGN" });
  const rows = components.data ?? [];
  const conceptImages = (
    (design.data?.data as { conceptImages?: { key: string; prompt?: string }[] } | null)
      ?.conceptImages ?? []
  )
    .slice()
    .reverse();
  const loading = components.isLoading || design.isLoading;

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6 lg:p-8" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="aspect-square w-full rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-3 pt-(--card-spacing)">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <BomTableSkeleton rows={2} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6 lg:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Industrial design</h1>
      {conceptImages.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Concept references</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {conceptImages.map((image) => (
                <img
                  key={image.key}
                  src={`/api/files/${image.key}`}
                  alt={image.prompt ?? "Concept image"}
                  title={image.prompt}
                  className="aspect-square w-full rounded-lg border object-cover"
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent>
          <DesignPanel projectId={projectId} branchId={branchId} canEdit={canEdit} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Design & finish BOM</CardTitle>
        </CardHeader>
        <CardContent>
          <BomTable
            projectId={projectId}
            branchId={branchId}
            canEdit={canEdit}
            discipline="DESIGN"
            components={rows.filter((c) => c.discipline === "DESIGN")}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The Engineer surface. Which editor shows is driven by the ?view= param in
 * the footer process bar; canvas views (schematic, PCB, model, code) are full-bleed.
 */
export function EngineerStage({ projectId, branchId, canEdit, view }: Props) {
  if (view === "sourcing") {
    return (
      <div className="h-full overflow-y-auto">
        <SourcingView projectId={projectId} branchId={branchId} canEdit={canEdit} />
      </div>
    );
  }
  if (view === "design") {
    return (
      <div className="h-full overflow-y-auto">
        <DesignView projectId={projectId} branchId={branchId} canEdit={canEdit} />
      </div>
    );
  }
  if (view === "model") {
    return (
      <div className="relative h-full overflow-hidden">
        <ModelEditor projectId={projectId} branchId={branchId} canEdit={canEdit} />
      </div>
    );
  }
  if (view === "code") {
    return (
      <div className="h-full overflow-hidden">
        <CodeWorkspace projectId={projectId} branchId={branchId} canEdit={canEdit} />
      </div>
    );
  }
  if (view === "pcb") {
    return (
      <div className="relative h-full overflow-hidden">
        <PcbCanvas projectId={projectId} branchId={branchId} canEdit={canEdit} />
      </div>
    );
  }
  return (
    <div className="relative h-full overflow-hidden">
      <CircuitCanvas projectId={projectId} branchId={branchId} canEdit={canEdit} />
    </div>
  );
}
