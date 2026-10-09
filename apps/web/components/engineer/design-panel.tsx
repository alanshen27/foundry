"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useCollaborativeDesign } from "./use-collaborative-design";

type DesignNotes = {
  aesthetic?: string;
  materials?: string;
  colorway?: string;
  notes?: string;
};

/** Industrial-design notes (Engineer > Design tab). Autosaves like the editors. */
export function DesignPanel({
  projectId,
  branchId,
  canEdit: allowEdit,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
}) {
  const query = trpc.design.get.useQuery({ projectId, branchId, kind: "DESIGN" });
  const save = trpc.design.save.useMutation();

  const [form, setForm] = useState<DesignNotes>({});
  const dirtyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseRef = useRef<unknown>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const shared = useCollaborativeDesign({
    projectId,
    branchId,
    kind: "DESIGN",
    canEdit: allowEdit,
    onRemoteData: (data) => {
      if (dirtyRef.current) return;
      const next = data && typeof data === "object" ? (data as DesignNotes) : {};
      baseRef.current = next;
      setForm(next);
    },
  });
  const canEdit = allowEdit && shared.canEdit && (shared.mode === "local" || shared.ready);

  useEffect(() => {
    if ((shared.mode === "local" || shared.awaitingLive) && !dirtyRef.current && query.data?.data) {
      baseRef.current = query.data.data;
      setForm(query.data.data as DesignNotes);
    }
  }, [query.data, shared.mode, shared.awaitingLive]);

  const set = useCallback(
    (key: keyof DesignNotes, value: string) => {
      if (!canEdit) return;
      const next = { ...form, [key]: value };
      if (timer.current) clearTimeout(timer.current);
      if (shared.mode !== "local") {
        try {
          shared.applySnapshot(baseRef.current, next);
          setWriteError(null);
        } catch (error) {
          setWriteError(error instanceof Error ? error.message : "Could not synchronize notes");
        }
        return;
      }
      setForm(next);
      dirtyRef.current = true;
      timer.current = setTimeout(() => {
        save.mutate(
          { projectId, branchId, kind: "DESIGN", baseData: baseRef.current, data: next },
          {
            onSuccess: (saved) => {
              dirtyRef.current = false;
              baseRef.current = saved.data;
            },
          },
        );
      }, 800);
    },
    [canEdit, projectId, branchId, save, form, shared],
  );

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading design notes">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Aesthetic direction</Label>
          <Input
            value={form.aesthetic ?? ""}
            onChange={(e) => set("aesthetic", e.target.value)}
            placeholder="Minimal, soft-touch, rounded corners"
            disabled={!canEdit}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Colorway</Label>
          <Input
            value={form.colorway ?? ""}
            onChange={(e) => set("colorway", e.target.value)}
            placeholder="Matte black with orange accent"
            disabled={!canEdit}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Materials & finish</Label>
        <Input
          value={form.materials ?? ""}
          onChange={(e) => set("materials", e.target.value)}
          placeholder="PC/ABS enclosure, anodised aluminium bezel"
          disabled={!canEdit}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Design notes</Label>
        <Textarea
          value={form.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
          rows={5}
          placeholder="Branding placement, texture, ergonomics, packaging…"
          disabled={!canEdit}
        />
      </div>
      <p
        className="text-muted-foreground text-xs"
        role={writeError || shared.error ? "alert" : "status"}
      >
        {writeError ??
          shared.error ??
          (shared.mode === "live"
            ? shared.ready
              ? "Live collaboration"
              : "Connecting collaboration…"
            : save.isPending
              ? "Saving…"
              : "Autosaves")}
      </p>
    </div>
  );
}
