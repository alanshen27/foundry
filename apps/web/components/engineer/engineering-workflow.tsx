"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  SlidersHorizontal,
  X,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { CadAssemblyInstance, CadDoc } from "@foundry/cad";
import type { EngineeringStep, EngineeringTarget } from "@/lib/engineering/readiness";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const VIEW_FOR_STEP: Record<EngineeringStep, EngineeringTarget["view"]> = {
  schematic: "schematic",
  pcb: "pcb",
  cad: "model",
  assembly: "assembly",
};
const STATE_LABELS = {
  missing: "Not started",
  attention: "Needs attention",
  outdated: "Out of date",
  current: "Current",
} as const;
const AXES = ["x", "y", "z"] as const;

type PlacementDraft = Omit<CadAssemblyInstance, "translationMm" | "rotationDeg"> & {
  translationMm: Record<(typeof AXES)[number], string>;
  rotationDeg: Record<(typeof AXES)[number], string>;
};

function placementDrafts(instances: CadAssemblyInstance[]): PlacementDraft[] {
  return instances.map((instance) => ({
    ...instance,
    translationMm: {
      x: String(instance.translationMm.x),
      y: String(instance.translationMm.y),
      z: String(instance.translationMm.z),
    },
    rotationDeg: {
      x: String(instance.rotationDeg.x),
      y: String(instance.rotationDeg.y),
      z: String(instance.rotationDeg.z),
    },
  }));
}

function PlacementEditor({
  cad,
  fingerprint,
  canEdit,
  busy,
  onDirtyChange,
  onSave,
}: {
  cad: CadDoc;
  fingerprint: string;
  canEdit: boolean;
  busy: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (instances: CadAssemblyInstance[], fingerprint: string) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState(() => placementDrafts(cad.assembly?.instances ?? []));
  const [baseline, setBaseline] = useState(fingerprint);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (dirty) return;
    setDrafts(placementDrafts(cad.assembly?.instances ?? []));
    setBaseline(fingerprint);
  }, [cad, fingerprint, dirty]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const valid =
    drafts.length > 0 &&
    drafts.some((instance) => instance.visible) &&
    drafts.every((instance) =>
      [instance.translationMm, instance.rotationDeg].every((vector) =>
        AXES.every(
          (axis) =>
            vector[axis].trim() !== "" &&
            Number.isFinite(Number(vector[axis])) &&
            Math.abs(Number(vector[axis])) <= 1_000_000,
        ),
      ),
    );
  const edit = (id: string, patch: Partial<PlacementDraft>) => {
    setDrafts((current) =>
      current.map((instance) => (instance.id === id ? { ...instance, ...patch } : instance)),
    );
    setDirty(true);
  };
  const save = async () => {
    if (!valid) return;
    const instances: CadAssemblyInstance[] = drafts.map((instance) => ({
      ...instance,
      translationMm: {
        x: Number(instance.translationMm.x),
        y: Number(instance.translationMm.y),
        z: Number(instance.translationMm.z),
      },
      rotationDeg: {
        x: Number(instance.rotationDeg.x),
        y: Number(instance.rotationDeg.y),
        z: Number(instance.rotationDeg.z),
      },
    }));
    try {
      await onSave(instances, baseline);
      setDirty(false);
    } catch {
      // The mutation error is shown by the workflow; retain edits for conflict recovery.
    }
  };

  if (!drafts.length) return null;
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label="Assembly placements">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] font-medium tracking-[0.08em] uppercase">
          Assembly placements
        </p>
        <span className="text-muted-foreground text-[11px]">Position mm · rotation °</span>
      </div>
      <div className="flex flex-col gap-2">
        {drafts.map((instance) => {
          const name =
            cad.components.find((part) => part.id === instance.componentId)?.name ?? "Missing part";
          const isSelected = instance.id === (selected ?? drafts[0]?.id);
          return (
            <div key={instance.id} className="border-border rounded-none border p-2">
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left text-xs"
                aria-expanded={isSelected}
                onClick={() => setSelected(isSelected ? "" : instance.id)}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                <ChevronDown className={cn("size-3 shrink-0", isSelected && "rotate-180")} />
              </button>
              <div hidden={!isSelected} className={cn("mt-3", !isSelected && "hidden")}>
                <div className="mb-3 flex items-center gap-4 text-[11px]">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={instance.visible}
                      disabled={!canEdit || busy}
                      onChange={(event) => edit(instance.id, { visible: event.target.checked })}
                    />{" "}
                    Include
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={instance.fixed}
                      disabled={!canEdit || busy}
                      onChange={(event) => edit(instance.id, { fixed: event.target.checked })}
                    />{" "}
                    Fixed
                  </label>
                </div>
                <div className="grid gap-3">
                  {(["translationMm", "rotationDeg"] as const).map((field) => (
                    <div key={field} className="grid grid-cols-3 gap-1">
                      {AXES.map((axis) => (
                        <label
                          key={axis}
                          className="text-muted-foreground flex min-w-0 flex-col gap-1 text-[10px]"
                        >
                          {field === "translationMm"
                            ? axis.toUpperCase()
                            : `R${axis.toUpperCase()}`}
                          <Input
                            type="number"
                            step={field === "translationMm" ? "0.1" : "1"}
                            className="h-7 px-1.5 font-mono text-[11px]"
                            aria-label={`${name} ${field === "translationMm" ? "position" : "rotation"} ${axis.toUpperCase()}`}
                            value={instance[field][axis]}
                            disabled={!canEdit || busy || instance.fixed}
                            onChange={(event) =>
                              edit(instance.id, {
                                [field]: { ...instance[field], [axis]: event.target.value },
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {dirty && baseline !== fingerprint ? (
        <p className="text-amber-700 text-xs dark:text-amber-400">
          The saved design changed while you were editing. Reload placements before applying
          changes.
        </p>
      ) : null}
      {dirty && !valid ? (
        <p className="text-destructive text-xs">
          Use finite coordinates and include at least one part.
        </p>
      ) : null}
      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!dirty || !valid || busy || baseline !== fingerprint}
            onClick={() => void save()}
          >
            Save placements
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!dirty || busy}
            onClick={() => {
              setDrafts(placementDrafts(cad.assembly?.instances ?? []));
              setBaseline(fingerprint);
              setDirty(false);
            }}
          >
            Reload placements
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Slim workflow strip with an optional inspector that never resizes the canvas. */
export function EngineeringWorkflow({
  projectId,
  branchId,
  onNavigate,
}: {
  projectId: string;
  branchId: string;
  onNavigate: (target: EngineeringTarget) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"issues" | "placement">("issues");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (expanded) panelRef.current?.focus();
  }, [expanded]);
  const closeInspector = () => {
    setExpanded(false);
    triggerRef.current?.focus();
  };
  const [placementsDirty, setPlacementsDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const scope = { projectId, branchId };
  const status = trpc.engineering.status.useQuery(scope, {
    staleTime: 2_000,
    refetchInterval: 15_000,
  });
  const sync = trpc.engineering.syncPcbToCad.useMutation();
  const build = trpc.engineering.buildAssembly.useMutation();
  const busy = sync.isPending || build.isPending;
  const result = status.data;

  const refresh = async () => {
    await Promise.all([
      utils.engineering.status.invalidate(scope),
      utils.design.get.invalidate({ ...scope, kind: "MODEL3D" }),
      utils.verify.listChecks.invalidate(scope),
    ]);
  };
  const updateCad = async () => {
    if (!result) return;
    setMessage(null);
    try {
      const updated = await sync.mutateAsync({ ...scope, expectedFingerprint: result.fingerprint });
      utils.engineering.status.setData(scope, updated);
      await refresh();
      setMessage("CAD board parts updated. Review the assembly before rebuilding it.");
    } catch {
      // The server conflict or permission error is shown below.
    }
  };
  const buildAssembly = async (instances?: CadAssemblyInstance[], expectedFingerprint?: string) => {
    if (!result) return;
    setMessage(null);
    const updated = await build.mutateAsync({
      ...scope,
      expectedFingerprint: expectedFingerprint ?? result.fingerprint,
      ...(instances ? { instances } : {}),
    });
    utils.engineering.status.setData(scope, updated);
    await refresh();
    setMessage(
      instances
        ? "Assembly placements saved."
        : "Linked assembly built from the current manufacturing parts.",
    );
    setInspectorTab("placement");
    onNavigate({ view: "assembly" });
  };

  if (!result) {
    return (
      <div className="bg-background flex min-h-9 shrink-0 items-center gap-2 border-b px-3 font-mono text-[10px] tracking-[0.06em] uppercase">
        {status.isError ? (
          <>
            <span className="text-muted-foreground">Workflow status unavailable.</span>
            <Button size="xs" variant="ghost" onClick={() => void status.refetch()}>
              Retry
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="size-3 animate-spin" />
            <span className="text-muted-foreground">Loading engineering workflow…</span>
          </>
        )}
      </div>
    );
  }
  const { report } = result;
  const mutationError = sync.error ?? build.error;
  return (
    <section
      className="bg-background h-9 shrink-0 border-b"
      aria-label="Connected engineering workflow"
    >
      <div className="flex h-9 items-center gap-2 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {report.stages.map((step, index) => (
            <div key={step.id} className="flex shrink-0 items-center gap-1">
              {index > 0 ? <ArrowRight className="text-muted-foreground/60 mx-1 size-3" /> : null}
              <button
                type="button"
                onClick={() => onNavigate({ view: VIEW_FOR_STEP[step.id] })}
                className="hover:bg-muted focus-visible:ring-primary flex items-center gap-1.5 rounded-none px-1.5 py-1 font-mono text-[10px] tracking-[0.1em] uppercase outline-none focus-visible:ring-2"
                title={`${step.label}: ${STATE_LABELS[step.state]}. ${step.summary}`}
              >
                <span
                  className={cn(
                    "size-1.5",
                    step.state === "current"
                      ? "bg-foreground"
                      : step.state === "missing"
                        ? "bg-muted-foreground/50"
                        : "bg-primary",
                  )}
                  aria-hidden
                />
                {step.label}
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          ref={triggerRef}
          aria-expanded={expanded}
          aria-controls="engineering-workflow-details"
          onClick={() => setExpanded((value) => !value)}
          className="hover:bg-muted flex shrink-0 items-center gap-1.5 rounded-none px-2 py-1 font-mono text-[10px] tracking-[0.08em] uppercase"
        >
          {report.counts.errors + report.counts.warnings
            ? `${report.counts.errors + report.counts.warnings} to review`
            : "Inspect"}
          <SlidersHorizontal className="size-3" />
        </button>
      </div>
      <aside
        ref={panelRef}
        id="engineering-workflow-details"
        aria-label="Engineering inspector"
        tabIndex={-1}
        hidden={!expanded}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            closeInspector();
          }
        }}
        className={cn(
          "absolute right-0 top-9 bottom-0 z-40 flex w-80 max-w-[85%] flex-col border-l bg-background shadow-none outline-none",
          !expanded && "hidden",
        )}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
          <span className="font-mono text-[11px] font-medium tracking-[0.1em] uppercase">
            Engineering
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Refresh workflow"
              aria-label="Refresh workflow"
              disabled={status.isFetching || busy}
              onClick={() => void status.refetch()}
            >
              <RefreshCw className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close engineering inspector"
              onClick={closeInspector}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex shrink-0 border-b px-3" role="tablist" aria-label="Inspector view">
          {(["issues", "placement"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={inspectorTab === tab}
              onClick={() => setInspectorTab(tab)}
              className={cn(
                "border-b-2 px-3 py-2 font-mono text-[10px] tracking-[0.08em] uppercase",
                inspectorTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground",
              )}
            >
              {tab === "issues" ? "Review" : "Placement"}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {mutationError ? (
            <p role="alert" className="mb-3 text-xs text-destructive">
              {mutationError.message}
            </p>
          ) : null}
          {message ? (
            <p role="status" className="mb-3 text-xs text-muted-foreground">
              {message}
            </p>
          ) : null}
          <div
            hidden={inspectorTab !== "issues"}
            className={cn("flex flex-col", inspectorTab !== "issues" && "hidden")}
          >
            {report.issues.length ? (
              report.issues.map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => {
                    onNavigate(issue.target);
                    closeInspector();
                  }}
                  className="hover:bg-muted flex items-start gap-2 border-b py-3 text-left"
                >
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0",
                      issue.severity === "error" ? "bg-primary" : "bg-muted-foreground/60",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[11px] font-medium">{issue.title}</span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                      {issue.detail}
                    </span>
                  </span>
                  <ArrowUpRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                </button>
              ))
            ) : (
              <p className="py-2 text-xs text-muted-foreground">
                Documents are connected and current. Engineering checks are in Verify.
              </p>
            )}
          </div>
          <div
            hidden={inspectorTab !== "placement"}
            className={cn(inspectorTab !== "placement" && "hidden")}
          >
            {result.cad.assembly?.instances.length ? (
              <PlacementEditor
                cad={result.cad}
                fingerprint={result.fingerprint}
                canEdit={result.canBuildAssembly}
                busy={busy}
                onDirtyChange={setPlacementsDirty}
                onSave={(instances, fingerprint) => buildAssembly(instances, fingerprint)}
              />
            ) : (
              <p className="py-2 text-xs text-muted-foreground">
                Build a linked assembly to place its parts.
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 border-t p-3">
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-[10px] tracking-[0.06em] uppercase"
            disabled={!result.canSyncCad || !report.counts.boards || busy || placementsDirty}
            onClick={() => void updateCad()}
          >
            {sync.isPending ? <Loader2 className="size-3 animate-spin" /> : null}Update CAD from
            boards
          </Button>
          <Button
            size="sm"
            className="font-mono text-[10px] tracking-[0.06em] uppercase"
            disabled={!result.canBuildAssembly || !report.counts.parts || busy || placementsDirty}
            onClick={() => {
              void buildAssembly().catch(() => undefined);
            }}
          >
            {build.isPending ? <Loader2 className="size-3 animate-spin" /> : null}Build linked
            assembly
          </Button>
          {placementsDirty ? (
            <p className="text-[11px] text-muted-foreground">
              Save or reload your placement edits first.
            </p>
          ) : null}
          <p
            className="text-[10px] text-muted-foreground"
            title="Build replaces the product preview. Physical fit and engineering approval still require verification."
          >
            {report.label} · Fit requires verification
          </p>
        </div>
      </aside>
    </section>
  );
}
