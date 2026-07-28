"use client";

/**
 * Feature toolbar for the mechanical editor. Each tool appends Zoo KCL to
 * main.kcl (extrude, mirror, rotate, planes, …) — source of truth stays code.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpFromLine,
  Box,
  Circle,
  Combine,
  Cylinder,
  Disc,
  FlipHorizontal2,
  Layers,
  Minus,
  Move,
  Pentagon,
  Radius,
  RefreshCw,
  RotateCw,
  Scaling,
  Scissors,
  Square,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  applyCadTool,
  CAD_TOOL_GROUPS,
  CAD_TOOLS,
  defaultValues,
  findLastSolid,
  getCadTool,
  type CadToolDef,
  type CadToolGroup,
  type CadToolValues,
} from "@/lib/cad/tools";

const TOOL_ICONS: Record<string, LucideIcon> = {
  plane: Layers,
  rectangle: Square,
  circle: Circle,
  box: Box,
  cylinder: Cylinder,
  extrude: ArrowUpFromLine,
  revolve: RefreshCw,
  fillet: Radius,
  chamfer: Pentagon,
  shell: Disc,
  hole: Circle,
  mirror: FlipHorizontal2,
  rotate: RotateCw,
  translate: Move,
  scale: Scaling,
  patternLinear: Layers,
  patternCircular: RefreshCw,
  union: Combine,
  subtract: Minus,
  intersect: Scissors,
};

function ToolIconButton({
  tool,
  disabled,
  active,
  onClick,
}: {
  tool: CadToolDef;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  const Icon = TOOL_ICONS[tool.id] ?? Box;
  return (
    <button
      type="button"
      title={`${tool.label} — ${tool.description}`}
      aria-label={tool.label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-primary relative flex size-8 items-center justify-center rounded-none transition-colors",
        "hover:bg-muted hover:text-primary",
        "disabled:pointer-events-none disabled:opacity-30",
        active && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary",
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} />
    </button>
  );
}

function FieldGrid({
  tool,
  values,
  onChange,
}: {
  tool: CadToolDef;
  values: CadToolValues;
  onChange: (key: string, value: number | string | boolean) => void;
}) {
  if (!tool.fields.length) {
    return (
      <p className="text-muted-foreground text-[11px] leading-relaxed">
        Applies to the last solids in the script — no parameters needed.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {tool.fields.map((field) => {
        const wide =
          field.type === "select" || field.type === "boolean" || tool.fields.length === 1;
        return (
          <label
            key={field.key}
            className={cn("flex flex-col gap-1", wide && "col-span-2")}
            htmlFor={`cad-tool-${field.key}`}
          >
            <span className="text-muted-foreground flex items-baseline justify-between text-[10px] font-medium tracking-wide uppercase">
              {field.label}
              {field.type === "number" && field.unit ? (
                <span className="normal-case opacity-70">{field.unit}</span>
              ) : null}
            </span>
            {field.type === "number" ? (
              <Input
                id={`cad-tool-${field.key}`}
                type="number"
                value={Number(values[field.key] ?? field.default)}
                min={field.min}
                step={field.step ?? 1}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) onChange(field.key, n);
                }}
                className="h-8 font-mono text-xs tabular-nums"
              />
            ) : field.type === "select" ? (
              <select
                id={`cad-tool-${field.key}`}
                value={String(values[field.key] ?? field.default)}
                onChange={(e) => onChange(field.key, e.target.value)}
                className={cn(
                  "border-input bg-background h-8 w-full rounded-none border px-2 text-xs outline-none",
                  "focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-3",
                )}
              >
                {field.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <button
                id={`cad-tool-${field.key}`}
                type="button"
                role="switch"
                aria-checked={Boolean(values[field.key] ?? field.default)}
                onClick={() => onChange(field.key, !Boolean(values[field.key] ?? field.default))}
                className={cn(
                  "border-input flex h-8 items-center justify-between rounded-none border px-2.5 text-xs",
                  "hover:bg-muted/50 transition-colors",
                )}
              >
                <span>{Boolean(values[field.key] ?? field.default) ? "On" : "Off"}</span>
                <span
                  className={cn(
                    "relative h-4 w-7 rounded-full transition-colors",
                    Boolean(values[field.key] ?? field.default)
                      ? "bg-primary"
                      : "bg-muted-foreground/30",
                  )}
                >
                  <span
                    className={cn(
                      "bg-background absolute top-0.5 size-3 rounded-full shadow transition-transform",
                      Boolean(values[field.key] ?? field.default) ? "left-3.5" : "left-0.5",
                    )}
                  />
                </span>
              </button>
            )}
          </label>
        );
      })}
    </div>
  );
}

export function CadToolsPanel({
  script,
  canEdit,
  onApply,
}: {
  script: string;
  canEdit: boolean;
  onApply: (nextScript: string) => void;
}) {
  const [groupId, setGroupId] = useState<CadToolGroup>("create");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [values, setValues] = useState<CadToolValues>({});
  const [error, setError] = useState<string | null>(null);

  const active = activeId ? getCadTool(activeId) : undefined;
  const lastSolid = useMemo(() => findLastSolid(script), [script]);

  const byGroup = useMemo(() => {
    const map = new Map<CadToolGroup, CadToolDef[]>();
    for (const g of CAD_TOOL_GROUPS) map.set(g.id, []);
    for (const t of CAD_TOOLS) map.get(t.group)?.push(t);
    return map;
  }, []);

  const groupTools = byGroup.get(groupId) ?? [];

  useEffect(() => {
    if (!activeId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setActiveId(null);
        setError(null);
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        document.getElementById("cad-tool-apply")?.click();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId]);

  function openTool(tool: CadToolDef) {
    if (activeId === tool.id) {
      setActiveId(null);
      setError(null);
      return;
    }
    setError(null);
    setActiveId(tool.id);
    setValues(defaultValues(tool));
  }

  function apply() {
    if (!active || !canEdit) return;
    try {
      const result = applyCadTool(script, active.id, values);
      onApply(result.script);
      setActiveId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply tool");
    }
  }

  const ActiveIcon = active ? (TOOL_ICONS[active.id] ?? Box) : Box;

  return (
    <div className="pointer-events-none absolute top-14 left-3 z-30 flex items-start gap-2">
      {/* Icon rail */}
      <div className="bg-card/95 pointer-events-auto flex flex-col overflow-hidden rounded-none border shadow-lg backdrop-blur-md">
        <div className="border-border/70 flex gap-0.5 border-b p-1">
          {CAD_TOOL_GROUPS.map((g) => {
            const count = byGroup.get(g.id)?.length ?? 0;
            if (!count) return null;
            const selected = groupId === g.id;
            return (
              <button
                key={g.id}
                type="button"
                title={g.label}
                onClick={() => {
                  setGroupId(g.id);
                  setActiveId(null);
                  setError(null);
                }}
                className={cn(
                  "rounded-none px-1.5 py-1 text-[10px] font-medium tracking-wide transition-colors",
                  selected
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {g.label.slice(0, 3)}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-0.5 p-1.5">
          {groupTools.map((tool) => (
            <ToolIconButton
              key={tool.id}
              tool={tool}
              disabled={!canEdit || (tool.requiresSolid && !lastSolid)}
              active={activeId === tool.id}
              onClick={() => openTool(tool)}
            />
          ))}
        </div>

        {lastSolid ? (
          <div
            className="border-border/70 text-muted-foreground border-t px-2 py-1.5 text-center font-mono text-[9px] tracking-tight"
            title={`Last solid: ${lastSolid}`}
          >
            <span className="text-foreground/80 block max-w-18 truncate">{lastSolid}</span>
          </div>
        ) : null}
      </div>

      {/* Inline inspector — no modal */}
      {active ? (
        <div className="bg-card/95 pointer-events-auto w-64 animate-in fade-in-0 slide-in-from-left-1 zoom-in-95 overflow-hidden rounded-none border shadow-lg backdrop-blur-md duration-150">
          <div className="border-border/70 flex items-start gap-2.5 border-b px-3 py-2.5">
            <div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-none">
              <ActiveIcon className="size-4" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="truncate text-sm font-medium leading-none">{active.label}</div>
              <p className="text-muted-foreground mt-1 text-[11px] leading-snug">
                {active.description}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => {
                setActiveId(null);
                setError(null);
              }}
              className="text-muted-foreground hover:bg-muted hover:text-foreground -mr-1 -mt-0.5 flex size-7 items-center justify-center rounded-none"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="space-y-3 px-3 py-3">
            {active.requiresSolid && lastSolid ? (
              <div className="bg-muted/50 text-muted-foreground flex items-center gap-2 rounded-none px-2.5 py-1.5 text-[11px]">
                <span className="shrink-0">Target</span>
                <span className="text-foreground ml-auto truncate font-mono text-[11px]">
                  {lastSolid}
                </span>
              </div>
            ) : null}

            <FieldGrid
              tool={active}
              values={values}
              onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
            />

            {error ? <p className="text-destructive text-[11px] leading-snug">{error}</p> : null}
          </div>

          <div className="border-border/70 bg-muted/30 flex items-center justify-between gap-2 border-t px-3 py-2.5">
            <span className="text-muted-foreground hidden text-[10px] sm:inline">⌘↵ apply</span>
            <div className="ml-auto flex gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={() => {
                  setActiveId(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                id="cad-tool-apply"
                type="button"
                size="sm"
                className="h-8 px-3 text-xs"
                disabled={!canEdit}
                onClick={apply}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
