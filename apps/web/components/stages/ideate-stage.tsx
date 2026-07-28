"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { trpc } from "@/lib/trpc";
import { dollarsToCents, selectClass } from "@/lib/format";

const REQUIREMENT_TYPES = [
  "FUNCTIONAL",
  "ELECTRICAL",
  "MECHANICAL",
  "SOFTWARE",
  "VISUAL",
  "MANUFACTURING",
  "COST",
  "COMPLIANCE",
  "UX",
] as const;
const PRIORITIES = ["MUST", "SHOULD", "MAY"] as const;
const STATUSES = ["PROPOSED", "ACCEPTED", "REJECTED"] as const;

type Props = { projectId: string; branchId: string; canEdit: boolean };

export function IdeateStage({ projectId, branchId, canEdit }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <BriefCard projectId={projectId} branchId={branchId} canEdit={canEdit} />
      <RequirementsCard projectId={projectId} branchId={branchId} canEdit={canEdit} />
    </div>
  );
}

function BriefCard({ projectId, branchId, canEdit }: Props) {
  const router = useRouter();
  const brief = trpc.ideate.getBrief.useQuery({ projectId, branchId });
  const utils = trpc.useUtils();
  const save = trpc.ideate.saveBrief.useMutation({
    onSuccess: () => {
      void utils.ideate.getBrief.invalidate({ projectId, branchId });
      router.refresh();
    },
  });

  const [form, setForm] = useState({
    prompt: "",
    intendedUse: "",
    environment: "",
    targetAudience: "",
    budget: "",
    dimensions: "",
    performanceTargets: "",
    manufacturingNotes: "",
  });

  useEffect(() => {
    const b = brief.data;
    if (b) {
      setForm({
        prompt: b.prompt ?? "",
        intendedUse: b.intendedUse ?? "",
        environment: b.environment ?? "",
        targetAudience: b.targetAudience ?? "",
        budget: b.budgetCents != null ? String(b.budgetCents / 100) : "",
        dimensions: b.dimensions ?? "",
        performanceTargets: b.performanceTargets ?? "",
        manufacturingNotes: b.manufacturingNotes ?? "",
      });
    }
  }, [brief.data]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({
      projectId,
      branchId,
      prompt: form.prompt || null,
      intendedUse: form.intendedUse || null,
      environment: form.environment || null,
      targetAudience: form.targetAudience || null,
      budgetCents: dollarsToCents(form.budget),
      dimensions: form.dimensions || null,
      performanceTargets: form.performanceTargets || null,
      manufacturingNotes: form.manufacturingNotes || null,
    });
  }

  if (brief.isLoading) {
    return (
      <Card aria-busy="true" aria-label="Loading product brief">
        <CardHeader className="gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-20 w-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-8 w-28" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product brief</CardTitle>
        <p className="text-muted-foreground text-sm">
          Capture intent and constraints. This grounds every downstream stage.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="What are you building?">
            <Textarea
              value={form.prompt}
              onChange={(e) => set("prompt", e.target.value)}
              placeholder="A compact desk sensor that logs temperature and humidity…"
              rows={3}
              disabled={!canEdit}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Intended use">
              <Input
                value={form.intendedUse}
                onChange={(e) => set("intendedUse", e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Operating environment">
              <Input
                value={form.environment}
                onChange={(e) => set("environment", e.target.value)}
                placeholder="Indoor, 0–40°C"
                disabled={!canEdit}
              />
            </Field>
            <Field label="Target audience">
              <Input
                value={form.targetAudience}
                onChange={(e) => set("targetAudience", e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Budget (USD, per unit)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.budget}
                onChange={(e) => set("budget", e.target.value)}
                placeholder="49.99"
                disabled={!canEdit}
              />
            </Field>
            <Field label="Target dimensions">
              <Input
                value={form.dimensions}
                onChange={(e) => set("dimensions", e.target.value)}
                placeholder="80 × 50 × 20 mm"
                disabled={!canEdit}
              />
            </Field>
            <Field label="Performance targets">
              <Input
                value={form.performanceTargets}
                onChange={(e) => set("performanceTargets", e.target.value)}
                placeholder="≥ 12 months battery"
                disabled={!canEdit}
              />
            </Field>
          </div>
          <Field label="Manufacturing notes">
            <Textarea
              value={form.manufacturingNotes}
              onChange={(e) => set("manufacturingNotes", e.target.value)}
              rows={2}
              disabled={!canEdit}
            />
          </Field>
          {canEdit ? (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save brief"}
              </Button>
              {save.isSuccess ? <span className="text-sm text-emerald-400">Saved</span> : null}
              {save.error ? (
                <span className="text-destructive text-sm">{save.error.message}</span>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              You have read-only access to this stage.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function RequirementsCard({ projectId, branchId, canEdit }: Props) {
  const router = useRouter();
  const list = trpc.ideate.listRequirements.useQuery({ projectId, branchId });
  const utils = trpc.useUtils();
  const invalidate = () => {
    router.refresh();
    return utils.ideate.listRequirements.invalidate({ projectId, branchId });
  };

  const create = trpc.ideate.createRequirement.useMutation({ onSuccess: invalidate });
  const update = trpc.ideate.updateRequirement.useMutation({ onSuccess: invalidate });
  const remove = trpc.ideate.deleteRequirement.useMutation({ onSuccess: invalidate });

  const [title, setTitle] = useState("");
  const [type, setType] = useState<(typeof REQUIREMENT_TYPES)[number]>("FUNCTIONAL");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("SHOULD");

  function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate(
      { projectId, branchId, title: title.trim(), type, priority },
      { onSuccess: () => setTitle("") },
    );
  }

  const requirements = list.data ?? [];

  if (list.isLoading) {
    return (
      <Card aria-busy="true" aria-label="Loading requirements">
        <CardHeader className="gap-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 min-w-60 flex-1" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-14" />
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-start justify-between gap-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-3/5" />
                <div className="flex gap-1.5">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              </div>
              <Skeleton className="h-8 w-28" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Requirements</CardTitle>
        <p className="text-muted-foreground text-sm">
          {requirements.length} requirement{requirements.length === 1 ? "" : "s"} · structured and
          testable.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canEdit ? (
          <form onSubmit={onAdd} className="flex flex-wrap items-center gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Device must run 12 months on a coin cell"
              className="min-w-60 flex-1"
              aria-label="Requirement title"
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className={selectClass}
              aria-label="Requirement type"
            >
              {REQUIREMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className={selectClass}
              aria-label="Requirement priority"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={create.isPending}>
              Add
            </Button>
          </form>
        ) : null}

        {requirements.length === 0 ? (
          <EmptyState title="No requirements yet">
            {canEdit
              ? "Add your first requirement above to start shaping the concept."
              : "Requirements will appear here once added."}
          </EmptyState>
        ) : (
          <ul className="divide-border divide-y">
            {requirements.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.title}</p>
                  {r.description ? (
                    <p className="text-muted-foreground text-sm">{r.description}</p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={r.type} />
                    <StatusBadge status={r.priority} />
                    <StatusBadge status={r.status} />
                  </div>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      value={r.status}
                      onChange={(e) =>
                        update.mutate({
                          id: r.id,
                          status: e.target.value as (typeof STATUSES)[number],
                        })
                      }
                      className={selectClass}
                      aria-label={`Status for ${r.title}`}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove.mutate({ id: r.id })}
                      disabled={remove.isPending}
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
