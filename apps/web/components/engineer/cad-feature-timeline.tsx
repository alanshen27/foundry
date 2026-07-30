"use client";

import {
  Box,
  Boxes,
  CircleDashed,
  Combine,
  FileInput,
  History,
  Move3d,
  Radius,
  Repeat2,
} from "lucide-react";
import type { CadFeature, CadFeatureKind } from "@/lib/cad/features";
import { cn } from "@/lib/utils";

const FEATURE_ICONS: Record<CadFeatureKind, typeof Box> = {
  import: FileInput,
  sketch: CircleDashed,
  solid: Box,
  modify: Radius,
  transform: Move3d,
  pattern: Repeat2,
  boolean: Combine,
  unknown: Boxes,
};

export function CadFeatureTimeline({
  features,
  selectedId,
  onSelect,
}: {
  features: CadFeature[];
  selectedId: string | null;
  onSelect: (feature: CadFeature | null) => void;
}) {
  if (features.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30 flex justify-center">
      <div
        className="bg-card/95 pointer-events-auto flex max-w-full items-center overflow-hidden rounded-xl border shadow-lg backdrop-blur-md"
        role="region"
        aria-label="CAD feature timeline"
      >
        <button
          type="button"
          title="Clear feature selection"
          aria-pressed={!selectedId}
          onClick={() => onSelect(null)}
          className={cn(
            "border-border/70 flex h-10 shrink-0 items-center gap-1.5 border-r px-2.5 text-[10px] font-medium",
            selectedId
              ? "text-muted-foreground hover:bg-muted hover:text-foreground"
              : "bg-primary/10 text-primary",
          )}
        >
          <History className="size-3.5" />
          History
        </button>
        <div className="flex max-w-[min(72vw,760px)] items-center gap-0.5 overflow-x-auto p-1">
          {features.map((feature, index) => {
            const Icon = FEATURE_ICONS[feature.kind];
            const selected = selectedId === feature.id;
            return (
              <button
                key={feature.id}
                type="button"
                aria-pressed={selected}
                aria-label={`Feature ${index + 1}: ${feature.operation}, lines ${feature.lineStart} through ${feature.lineEnd}`}
                title={`${feature.label}\nLines ${feature.lineStart}–${feature.lineEnd}`}
                onClick={() => onSelect(selected ? null : feature)}
                className={cn(
                  "group flex h-8 min-w-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[10px] transition-colors",
                  selected
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="font-mono text-[9px] opacity-60">{index + 1}</span>
                <Icon className="size-3.5" strokeWidth={1.75} />
                <span className={cn("max-w-24 truncate", !selected && "hidden sm:inline")}>
                  {feature.operation}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
