"use client";

import { Check, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import {
  ACCENT_LABELS,
  ACCENT_SWATCHES,
  THEME_ACCENTS,
  type ThemeAccent,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Inline appearance controls for Settings — not a floating chrome toggle. */
export function ThemeSettingsPanel({ className }: { className?: string }) {
  const { theme, setMode, setAccent } = useTheme();

  return (
    <div className={cn("space-y-5", className)}>
      <div>
        <p className="text-muted-foreground mb-2 font-mono text-[11px] font-medium tracking-[0.1em] uppercase">
          Appearance
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "light" as const, label: "Light", icon: Sun },
              { value: "dark" as const, label: "Dark", icon: Moon },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-none border px-3 py-2.5 text-[13px] font-medium transition-colors",
                theme.mode === value
                  ? "border-foreground/20 bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-muted-foreground mb-2 font-mono text-[11px] font-medium tracking-[0.1em] uppercase">
          Accent
        </p>
        <div className="flex flex-wrap gap-2">
          {THEME_ACCENTS.map((accent) => (
            <AccentSwatch
              key={accent}
              accent={accent}
              selected={theme.accent === accent}
              onSelect={() => setAccent(accent)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AccentSwatch({
  accent,
  selected,
  onSelect,
}: {
  accent: ThemeAccent;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      title={ACCENT_LABELS[accent]}
      aria-label={ACCENT_LABELS[accent]}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "relative flex size-8 items-center justify-center rounded-none border transition-transform hover:scale-105",
        selected ? "border-foreground/30 outline outline-2 outline-offset-1" : "border-border",
      )}
      style={{
        background: ACCENT_SWATCHES[accent],
        outlineColor: selected ? ACCENT_SWATCHES[accent] : undefined,
      }}
    >
      {selected ? <Check className="size-3.5 text-white drop-shadow" strokeWidth={2.5} /> : null}
    </button>
  );
}
