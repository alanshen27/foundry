"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

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
  canEdit,
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

  useEffect(() => {
    if (!dirtyRef.current && query.data?.data) {
      setForm(query.data.data as DesignNotes);
    }
  }, [query.data]);

  const set = useCallback(
    (key: keyof DesignNotes, value: string) => {
      setForm((f) => {
        const next = { ...f, [key]: value };
        if (canEdit) {
          dirtyRef.current = true;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            save.mutate(
              { projectId, branchId, kind: "DESIGN", data: next },
              { onSuccess: () => (dirtyRef.current = false) },
            );
          }, 800);
        }
        return next;
      });
    },
    [canEdit, projectId, branchId, save],
  );

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
      <p className="text-muted-foreground text-xs">{save.isPending ? "Saving…" : "Autosaves"}</p>
    </div>
  );
}
