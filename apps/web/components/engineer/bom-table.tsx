"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { trpc } from "@/lib/trpc";
import { dollarsToCents, formatCents } from "@/lib/format";

type Discipline = "ELECTRONICS" | "MECHANICAL" | "SOFTWARE" | "DESIGN";

export type BomComponent = {
  id: string;
  discipline: string;
  name: string;
  refDes: string | null;
  manufacturer: string | null;
  partNumber: string | null;
  quantity: number;
  unitCostCents: number | null;
  sourceUrl: string | null;
};

export function BomTable({
  projectId,
  branchId,
  canEdit,
  discipline,
  components,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
  discipline: Discipline;
  components: BomComponent[];
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const invalidate = () => {
    router.refresh();
    return utils.engineer.listComponents.invalidate({ projectId, branchId });
  };
  const create = trpc.engineer.createComponent.useMutation({ onSuccess: invalidate });
  const remove = trpc.engineer.deleteComponent.useMutation({ onSuccess: invalidate });

  const [name, setName] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [cost, setCost] = useState("");

  function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      {
        projectId,
        branchId,
        discipline,
        name: name.trim(),
        partNumber: partNumber.trim() || null,
        quantity: Math.max(1, parseInt(quantity, 10) || 1),
        unitCostCents: dollarsToCents(cost),
      },
      {
        onSuccess: () => {
          setName("");
          setPartNumber("");
          setQuantity("1");
          setCost("");
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit ? (
        <form onSubmit={onAdd} className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Component name"
            className="min-w-44 flex-1"
            aria-label="Component name"
          />
          <Input
            value={partNumber}
            onChange={(e) => setPartNumber(e.target.value)}
            placeholder="Part #"
            className="w-32"
            aria-label="Part number"
          />
          <Input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-18"
            aria-label="Quantity"
          />
          <Input
            type="number"
            min="0"
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="Unit $"
            className="w-24"
            aria-label="Unit cost"
          />
          <Button type="submit" size="sm" disabled={create.isPending}>
            Add
          </Button>
        </form>
      ) : null}

      {components.length === 0 ? (
        <EmptyState title="No components yet">
          {canEdit
            ? "Add parts manually or ask the copilot to draft this section of the BOM."
            : "Components will appear here once added."}
        </EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs uppercase">
            <tr className="border-b">
              <th className="py-2 font-medium">Ref</th>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Part #</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Unit</th>
              <th className="py-2 text-right font-medium">Ext.</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.id} className="border-border/60 border-b">
                <td className="text-muted-foreground py-2 font-mono text-xs">{c.refDes ?? "—"}</td>
                <td className="py-2">
                  {c.name}
                  {c.manufacturer ? (
                    <span className="text-muted-foreground"> · {c.manufacturer}</span>
                  ) : null}
                </td>
                <td className="py-2">
                  {c.sourceUrl ? (
                    <a
                      href={c.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      {c.partNumber ?? "link"}
                    </a>
                  ) : (
                    (c.partNumber ?? "—")
                  )}
                </td>
                <td className="py-2 text-right">{c.quantity}</td>
                <td className="py-2 text-right">{formatCents(c.unitCostCents)}</td>
                <td className="py-2 text-right">
                  {formatCents((c.unitCostCents ?? 0) * c.quantity)}
                </td>
                <td className="py-2 text-right">
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => remove.mutate({ id: c.id })}
                      disabled={remove.isPending}
                    >
                      Delete
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
