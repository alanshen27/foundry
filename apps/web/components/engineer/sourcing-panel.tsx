"use client";

/**
 * Engineer > Sourcing: the bill of materials.
 *
 * `BomTable` had existed for some time with no route that rendered it, which
 * meant the BOM could only be filled in by the copilot and never inspected or
 * corrected by hand. This is the surface it was written for.
 *
 * It is also the natural home for impact analysis. Swapping a cell for a
 * smaller one is the change whose consequences are least visible and most
 * expensive — runtime, mass, the bay that holds it, the power firmware — so
 * the "what does this affect?" affordance lives on the row where the swap
 * actually happens.
 */

import type { SourcingQuote } from "@foundry/sourcing";
import { BomTable } from "@/components/engineer/bom-table";
import { trpc } from "@/lib/trpc";

const DISCIPLINES = [
  { kind: "ELECTRONICS", label: "Electronics" },
  { kind: "MECHANICAL", label: "Mechanical" },
] as const;

export function SourcingPanel({
  projectId,
  branchId,
  canEdit,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
}) {
  const list = trpc.engineer.listComponents.useQuery({ projectId, branchId });
  const components = list.data ?? [];

  // Only electronics get distributor estimates: a lifecycle status or lead
  // time for a printed enclosure would be invented, not estimated. One request
  // for the whole set keeps every badge and the section total consistent.
  const quotable = components.filter((c) => c.discipline === "ELECTRONICS");
  const quote = trpc.engineer.quoteComponents.useQuery(
    {
      projectId,
      parts: quotable.map((c) => ({
        id: c.id,
        name: c.name,
        partNumber: c.partNumber,
        quantity: c.quantity,
      })),
    },
    { enabled: quotable.length > 0 },
  );
  const quoteData = quote.data;
  const quotesByComponentId =
    quoteData?.ok === true
      ? new Map<string, SourcingQuote>(quotable.map((c, i) => [c.id, quoteData.quotes[i]!]))
      : undefined;
  const simulated = quoteData?.ok === true && quoteData.simulated;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-lg font-semibold">Sourcing</h1>
        <p className="text-muted-foreground text-sm">
          Every part the product is made of. Open the branch icon on a row to see what depends on it
          before you change one.
        </p>
        {simulated ? (
          <p className="text-muted-foreground mt-1 text-xs">
            Prices marked (est.), lifecycle, lead time and stock are simulated estimates — no
            distributor is connected yet.
          </p>
        ) : null}
      </header>

      {DISCIPLINES.map(({ kind, label }) => (
        <section key={kind} className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {label}
          </h2>
          <BomTable
            projectId={projectId}
            branchId={branchId}
            canEdit={canEdit}
            discipline={kind}
            components={components.filter((c) => c.discipline === kind)}
            isLoading={list.isLoading}
            quotes={kind === "ELECTRONICS" ? quotesByComponentId : undefined}
            quotesLoading={kind === "ELECTRONICS" && quote.isLoading}
          />
        </section>
      ))}
    </div>
  );
}
