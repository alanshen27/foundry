"use client";

import dynamic from "next/dynamic";
import { CircuitBoard, Code2, Boxes, Palette } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BomTable } from "@/components/engineer/bom-table";
import { CircuitEditor } from "@/components/engineer/circuit-editor";
import { DesignPanel } from "@/components/engineer/design-panel";
import { CodeWorkspace } from "@/components/engineer/code-workspace";
import { trpc } from "@/lib/trpc";
import { formatCents } from "@/lib/format";

const ModelEditor = dynamic(
  () => import("@/components/engineer/model-editor").then((m) => m.ModelEditor),
  {
    ssr: false,
    loading: () => (
      <div className="bg-background/60 flex h-[60vh] items-center justify-center rounded-xl border">
        <p className="text-muted-foreground text-sm">Loading 3D viewport…</p>
      </div>
    ),
  },
);

type Props = { projectId: string; branchId: string; canEdit: boolean };

export function EngineerStage({ projectId, branchId, canEdit }: Props) {
  const components = trpc.engineer.listComponents.useQuery({ projectId, branchId });
  const rows = components.data ?? [];
  const bomCents = rows.reduce((sum, c) => sum + (c.unitCostCents ?? 0) * c.quantity, 0);

  const byDiscipline = (d: string) => rows.filter((c) => c.discipline === d);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Tabs defaultValue="electronics" className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-4">
          <TabsList variant="line">
            <TabsTrigger value="electronics">
              <CircuitBoard data-icon="inline-start" className="size-4" /> Electronics
            </TabsTrigger>
            <TabsTrigger value="model">
              <Boxes data-icon="inline-start" className="size-4" /> Model
            </TabsTrigger>
            <TabsTrigger value="code">
              <Code2 data-icon="inline-start" className="size-4" /> Code
            </TabsTrigger>
            <TabsTrigger value="design">
              <Palette data-icon="inline-start" className="size-4" /> Design
            </TabsTrigger>
          </TabsList>
          <p className="text-muted-foreground text-sm">
            Est. unit cost{" "}
            <span className="text-foreground font-semibold tabular-nums">
              {formatCents(bomCents)}
            </span>
          </p>
        </div>

        <TabsContent value="electronics" className="mt-3 flex min-h-0 flex-col gap-4 overflow-y-auto">
          <CircuitEditor projectId={projectId} branchId={branchId} canEdit={canEdit} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Electronics BOM</CardTitle>
            </CardHeader>
            <CardContent>
              <BomTable
                projectId={projectId}
                branchId={branchId}
                canEdit={canEdit}
                discipline="ELECTRONICS"
                components={byDiscipline("ELECTRONICS")}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="model" className="mt-3 flex min-h-0 flex-col gap-4 overflow-y-auto">
          <ModelEditor projectId={projectId} branchId={branchId} canEdit={canEdit} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mechanical BOM</CardTitle>
            </CardHeader>
            <CardContent>
              <BomTable
                projectId={projectId}
                branchId={branchId}
                canEdit={canEdit}
                discipline="MECHANICAL"
                components={byDiscipline("MECHANICAL")}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="code" className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
          <div className="min-h-0 flex-1">
            <CodeWorkspace projectId={projectId} branchId={branchId} canEdit={canEdit} />
          </div>
          <details className="shrink-0">
            <summary className="text-muted-foreground cursor-pointer text-xs font-medium select-none">
              Software & services BOM ({byDiscipline("SOFTWARE").length})
            </summary>
            <div className="mt-3">
              <BomTable
                projectId={projectId}
                branchId={branchId}
                canEdit={canEdit}
                discipline="SOFTWARE"
                components={byDiscipline("SOFTWARE")}
              />
            </div>
          </details>
        </TabsContent>

        <TabsContent value="design" className="mt-3 flex min-h-0 flex-col gap-4 overflow-y-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Industrial design</CardTitle>
            </CardHeader>
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
                components={byDiscipline("DESIGN")}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
