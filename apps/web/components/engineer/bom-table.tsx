"use client";

import { ExternalLink, GitBranch, Package } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { ImpactPanel } from "@/components/graph/impact-panel";
import { StaleBadge, useStaleNodes } from "@/components/graph/stale-badge";
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
  imageUrl: string | null;
};

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

function ComponentPreview({
  name,
  imageUrl,
  sourceUrl,
}: {
  name: string;
  imageUrl: string | null;
  sourceUrl: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const showImage = Boolean(imageUrl) && !imageFailed;
  const showFavicon = !showImage && Boolean(sourceUrl) && !faviconFailed;

  return (
    <div className="bg-muted/40 flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-none border">
      {showImage ? (
        <img
          src={imageUrl!}
          alt=""
          className="size-full object-contain p-0.5"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : showFavicon ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(sourceHost(sourceUrl!))}&sz=64`}
          alt=""
          className="size-6 object-contain"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFaviconFailed(true)}
        />
      ) : (
        <Package className="text-muted-foreground size-4" aria-hidden />
      )}
      <span className="sr-only">{name}</span>
    </div>
  );
}

export function BomTableSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading components">
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 min-w-44 flex-1" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-18" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-14" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-1">
            <Skeleton className="size-11 shrink-0 rounded-none" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="hidden h-3 w-16 sm:block" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BomTable({
  projectId,
  branchId,
  canEdit,
  discipline,
  components,
  isLoading = false,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
  discipline: Discipline;
  components: BomComponent[];
  isLoading?: boolean;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const invalidate = () => {
    router.refresh();
    return utils.engineer.listComponents.invalidate({ projectId, branchId });
  };
  const create = trpc.engineer.createComponent.useMutation({ onSuccess: invalidate });
  const remove = trpc.engineer.deleteComponent.useMutation({ onSuccess: invalidate });

  // The BOM is where a component actually gets swapped, so it is where the
  // question "what does that break?" is worth asking.
  const stale = useStaleNodes(projectId, branchId);
  const [impactFor, setImpactFor] = useState<BomComponent | null>(null);

  const [name, setName] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [cost, setCost] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");

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
        sourceUrl: sourceUrl.trim() || null,
        imageUrl: imageUrl.trim() || null,
      },
      {
        onSuccess: () => {
          setName("");
          setPartNumber("");
          setQuantity("1");
          setCost("");
          setSourceUrl("");
          setImageUrl("");
        },
      },
    );
  }

  if (isLoading) {
    return <BomTableSkeleton />;
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit ? (
        <form onSubmit={onAdd} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="Source URL (datasheet / distributor)"
              className="min-w-52 flex-1"
              aria-label="Source URL"
            />
            <Input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="Preview image URL"
              className="min-w-52 flex-1"
              aria-label="Preview image URL"
            />
          </div>
          {create.error ? <p className="text-destructive text-xs">{create.error.message}</p> : null}
        </form>
      ) : null}

      {components.length === 0 ? (
        <EmptyState title="No components yet">
          {canEdit
            ? "Add parts manually or ask the copilot to draft this section of the BOM."
            : "Components will appear here once added."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs uppercase">
              <tr className="border-b">
                <th className="py-2 pr-2 font-medium" colSpan={2}>
                  Part
                </th>
                <th className="py-2 font-medium">Part #</th>
                <th className="py-2 font-medium">Source</th>
                <th className="py-2 text-right font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Unit</th>
                <th className="py-2 text-right font-medium">Ext.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {components.map((c) => {
                return (
                  <tr key={c.id} className="border-border/60 border-b">
                    <td className="py-2.5 pr-2 align-middle">
                      <ComponentPreview
                        name={c.name}
                        imageUrl={c.imageUrl}
                        sourceUrl={c.sourceUrl}
                      />
                    </td>
                    <td className="py-2.5 align-middle">
                      <div className="flex flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-1.5 font-medium">
                          {c.refDes ? (
                            <span className="text-muted-foreground font-mono text-xs font-normal">
                              {c.refDes}
                            </span>
                          ) : null}
                          {c.name}
                          <StaleBadge node={stale.byRefKey.get(`component:${c.id}`)} />
                        </span>
                        {c.manufacturer ? (
                          <span className="text-muted-foreground text-xs">{c.manufacturer}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="text-muted-foreground py-2.5 align-middle font-mono text-xs">
                      {c.partNumber ?? "—"}
                    </td>
                    <td className="py-2.5 align-middle">
                      {c.sourceUrl ? (
                        <a
                          href={c.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground inline-flex max-w-36 items-center gap-1 truncate underline-offset-2 hover:underline"
                          title={c.sourceUrl}
                        >
                          <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden />
                          <span className="truncate text-xs">{sourceHost(c.sourceUrl)}</span>
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right align-middle">{c.quantity}</td>
                    <td className="py-2.5 text-right align-middle">
                      {formatCents(c.unitCostCents)}
                    </td>
                    <td className="py-2.5 text-right align-middle">
                      {formatCents((c.unitCostCents ?? 0) * c.quantity)}
                    </td>
                    <td className="py-2.5 text-right align-middle">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setImpactFor(c)}
                          title={`What depends on ${c.name}?`}
                          aria-label={`What depends on ${c.name}?`}
                        >
                          <GitBranch className="size-3.5" aria-hidden />
                        </Button>
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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Portalled: the workspace renders each tab in an absolutely positioned
          z-10 layer, and a fixed overlay inside that stacking context cannot
          rise above the z-20 header — its close button ends up underneath. */}
      {impactFor && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex justify-end bg-black/20"
              role="dialog"
              aria-modal
            >
              <button
                type="button"
                className="flex-1 cursor-default"
                aria-label="Close impact panel"
                onClick={() => setImpactFor(null)}
              />
              <ImpactPanel
                projectId={projectId}
                branchId={branchId}
                refKey={`component:${impactFor.id}`}
                title={
                  impactFor.refDes ? `${impactFor.refDes} · ${impactFor.name}` : impactFor.name
                }
                canEdit={canEdit}
                onClose={() => setImpactFor(null)}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
