"use client";

/**
 * SIMULATED Engineer workspace for demo recordings (/demo/engineer).
 *
 * Renders the finished e-ink desk companion project with local, hardcoded
 * data: no auth, no DB, no Zoo engine. The 3D viewport is a local three.js
 * scene and the parameter panel rebuilds it live, so the surface reads like
 * the real CAD workspace. All output here is SIMULATED, never verified.
 */
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  CircuitBoard,
  Code,
  Combine,
  FileText,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Puzzle,
  SlidersHorizontal,
  Waypoints,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DotMatrixLoader } from "@/components/dot-matrix-loader";
import { useTheme } from "@/components/theme-provider";
import { defineFoundryMonacoThemes } from "@/lib/monaco-theme";
import { monacoThemeFor } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  DEFAULT_COMPANION_PARAMS,
  type CompanionParams,
  type CompanionView,
} from "@/components/demo/companion-viewport";

const CompanionViewport = dynamic(
  () => import("@/components/demo/companion-viewport").then((m) => m.CompanionViewport),
  {
    ssr: false,
    loading: () => <DotMatrixLoader className="absolute inset-0" label="Loading CAD" />,
  },
);

type DemoComponent = {
  id: string;
  name: string;
  kind: "part" | "assembly" | "instructions";
  path: string;
  content: string;
};

const KCL_ENCLOSURE = `// e-ink desk companion — front enclosure (rev C)
// Units: mm. Printed in matte PA12, bead-blasted.

bodyWidth = 148
bodyHeight = 98
bodyThickness = 14
cornerRadius = 6
wallThickness = 2.4

shell = startSketchOn(XY)
  |> startProfileAt([-bodyWidth / 2, -bodyHeight / 2], %)
  |> line(end = [bodyWidth, 0])
  |> line(end = [0, bodyHeight])
  |> line(end = [-bodyWidth, 0])
  |> close()
  |> extrude(length = bodyThickness)
  |> fillet(radius = cornerRadius, tags = [getNextAdjacentEdge(%)])

cavity = startSketchOn(offsetPlane(XY, offset = wallThickness))
  |> startProfileAt([
       -bodyWidth / 2 + wallThickness,
       -bodyHeight / 2 + wallThickness,
     ], %)
  |> line(end = [bodyWidth - wallThickness * 2, 0])
  |> line(end = [0, bodyHeight - wallThickness * 2])
  |> line(end = [-(bodyWidth - wallThickness * 2), 0])
  |> close()
  |> extrude(length = bodyThickness - wallThickness * 2)

enclosure = subtract([shell], tools = [cavity])
`;

const KCL_DISPLAY = `// 7.5" e-ink display module pocket + bezel
// Panel: GDEY075T7, 800x480, SPI

panelWidth = 132
panelHeight = 74
panelDepth = 1.2
bezelLip = 2.0

pocket = startSketchOn(XZ)
  |> startProfileAt([-panelWidth / 2, -panelHeight / 2], %)
  |> line(end = [panelWidth, 0])
  |> line(end = [0, panelHeight])
  |> line(end = [-panelWidth, 0])
  |> close()
  |> extrude(length = panelDepth + 0.3)

bezel = startSketchOn(XZ)
  |> startProfileAt([
       -panelWidth / 2 - bezelLip,
       -panelHeight / 2 - bezelLip,
     ], %)
  |> line(end = [panelWidth + bezelLip * 2, 0])
  |> line(end = [0, panelHeight + bezelLip * 2])
  |> line(end = [-(panelWidth + bezelLip * 2), 0])
  |> close()
  |> extrude(length = 2.4)
`;

const KCL_KICKSTAND = `// Kickstand leg — 22° desk tilt
// CNC 6061, tumbled. Friction hinge: 90mm torque bar.

legLength = 61
legWidth = 74
legThickness = 3
standAngle = 22

leg = startSketchOn(YZ)
  |> startProfileAt([-legWidth / 2, 0], %)
  |> line(end = [legWidth, 0])
  |> line(end = [0, -legLength])
  |> line(end = [-legWidth, 0])
  |> close()
  |> extrude(length = legThickness)
  |> rotate(axis = X, angle = standAngle)
`;

const KCL_ASSEMBLY = `// Product preview assembly — e-ink desk companion
import "parts/enclosure/main.kcl" as enclosure
import "parts/display-module/main.kcl" as display
import "parts/kickstand/main.kcl" as kickstand

standAngle = 22

product = assembly()
  |> place(enclosure, at = [0, 0, 0], rotate = [-standAngle, 0, 0])
  |> place(display, at = [0, 4, 7], rotate = [-standAngle, 0, 0])
  |> place(kickstand, at = [0, 29, -7])
`;

const INSTRUCTIONS_MD = `# Assembly instructions — rev C

1. Seat the 7.5" e-ink panel into the front bezel pocket. Route the FPC
   through the left channel before pressing the panel home.
2. Fasten the driver PCB to the four M2 bosses (0.4 N·m).
3. Clip the rotary encoder into the right-side cutout; the detent tab
   faces up.
4. Connect the 2000 mAh cell, then close the rear shell — snap fits
   engage bottom edge first.
5. Attach the kickstand torque bar with the two M2.5 shoulder screws.
`;

const ENCLOSURE_COMPONENT: DemoComponent = {
  id: "enclosure",
  name: "enclosure",
  kind: "part",
  path: "parts/enclosure/main.kcl",
  content: KCL_ENCLOSURE,
};

const COMPONENTS: DemoComponent[] = [
  ENCLOSURE_COMPONENT,
  {
    id: "display-module",
    name: "display-module",
    kind: "part",
    path: "parts/display-module/main.kcl",
    content: KCL_DISPLAY,
  },
  {
    id: "kickstand",
    name: "kickstand",
    kind: "part",
    path: "parts/kickstand/main.kcl",
    content: KCL_KICKSTAND,
  },
  {
    id: "product",
    name: "product",
    kind: "assembly",
    path: "assembly/product.kcl",
    content: KCL_ASSEMBLY,
  },
  {
    id: "assembly-guide",
    name: "assembly-guide",
    kind: "instructions",
    path: "docs/assembly-guide.md",
    content: INSTRUCTIONS_MD,
  },
];

const KIND_META = {
  part: { label: "Manufacturing", icon: Puzzle },
  assembly: { label: "Preview", icon: Boxes },
  instructions: { label: "Instructions", icon: FileText },
} as const;

const PARAM_DEFS: {
  key: keyof CompanionParams;
  label: string;
  step?: number;
  min?: number;
  max?: number;
}[] = [
  { key: "bodyWidthMm", label: "bodyWidth", step: 2, min: 100, max: 200 },
  { key: "bodyHeightMm", label: "bodyHeight", step: 2, min: 70, max: 140 },
  { key: "standAngleDeg", label: "standAngle", step: 1, min: 5, max: 40 },
  { key: "cornerRadiusMm", label: "cornerRadius", step: 0.5, min: 1, max: 7 },
  { key: "showKnob", label: "rotaryKnob" },
  { key: "showKickstand", label: "kickstand" },
];

function DemoParamsPanel({
  params,
  onSet,
}: {
  params: CompanionParams;
  onSet: (key: keyof CompanionParams, value: number | boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-card/85 absolute top-14 right-3 z-10 w-60 rounded-none border shadow-lg backdrop-blur-md">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 px-3 py-2"
      >
        <SlidersHorizontal className="text-primary size-3.5" />
        <span className="text-xs font-semibold">Parameters</span>
        <span className="text-muted-foreground ml-auto text-[10px]">{PARAM_DEFS.length}</span>
        {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
      </button>
      {!collapsed ? (
        <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto border-t px-3 py-2.5">
          {PARAM_DEFS.map((def) => {
            const value = params[def.key];
            return (
              <label key={def.key} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground min-w-0 flex-1 truncate">{def.label}</span>
                {typeof value === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => onSet(def.key, e.target.checked)}
                    className="accent-primary size-3.5"
                  />
                ) : (
                  <input
                    type="number"
                    value={value}
                    step={def.step}
                    min={def.min}
                    max={def.max}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) onSet(def.key, n);
                    }}
                    className="bg-background focus:border-ring w-20 rounded-none border px-1.5 py-0.5 text-right font-mono text-xs outline-none"
                  />
                )}
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const VIEW_BUTTONS: { id: CompanionView; label: string }[] = [
  { id: "iso", label: "ISO" },
  { id: "front", label: "F" },
  { id: "top", label: "T" },
  { id: "right", label: "R" },
];

export function EngineerDemo() {
  const { theme } = useTheme();
  const monacoTheme = monacoThemeFor(theme.mode);

  const [activeId, setActiveId] = useState("product");
  const [showTree, setShowTree] = useState(true);
  const [showCode, setShowCode] = useState(false);
  const [params, setParams] = useState<CompanionParams>(DEFAULT_COMPANION_PARAMS);
  const [view, setView] = useState<CompanionView>("iso");
  const [spin, setSpin] = useState(true);
  const [building, setBuilding] = useState(false);

  const active: DemoComponent = useMemo(
    () => COMPONENTS.find((c) => c.id === activeId) ?? ENCLOSURE_COMPONENT,
    [activeId],
  );
  const isKcl = active.kind !== "instructions";

  function setParam(key: keyof CompanionParams, value: number | boolean) {
    setParams((prev) => ({ ...prev, [key]: value }));
    // Brief "Building model" pulse so edits read like a real engine rebuild.
    setBuilding(true);
    setTimeout(() => setBuilding(false), 650);
  }

  return (
    <div className="bg-background fixed inset-0 flex flex-col overflow-hidden">
      {/* Document tab bar (Assembly pinned + CAD tab), like the Engineer stage. */}
      <div className="bg-card/60 flex h-9 shrink-0 items-center border-b px-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          <div className="text-muted-foreground hover:bg-muted/50 flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-none px-2.5 text-xs">
            <Combine className="size-3" strokeWidth={2} />
            <span>Assembly</span>
          </div>
          <div className="bg-muted text-foreground flex h-7 shrink-0 items-center gap-1.5 rounded-none px-2.5 text-xs">
            <Boxes className="size-3" strokeWidth={2} />
            <span>CAD</span>
          </div>
          <div className="text-muted-foreground hover:bg-muted/50 flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-none px-2.5 text-xs">
            <Waypoints className="size-3" strokeWidth={2} />
            <span>Schematic</span>
          </div>
          <div className="text-muted-foreground hover:bg-muted/50 flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-none px-2.5 text-xs">
            <CircuitBoard className="size-3" strokeWidth={2} />
            <span>PCB</span>
          </div>
        </div>
        <span className="bg-primary/10 text-primary mr-1 shrink-0 rounded-none border border-current/20 px-2 py-0.5 text-[10px] font-semibold tracking-wide">
          SIMULATED DEMO
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex">
          {showTree ? (
            <div className="bg-card/40 flex w-52 shrink-0 flex-col border-r">
              <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
                <Boxes className="text-primary size-3.5" />
                <span className="text-xs font-medium">CAD workspace</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
                {(["part", "assembly", "instructions"] as const).map((kind) => {
                  const meta = KIND_META[kind];
                  const Icon = meta.icon;
                  const items = COMPONENTS.filter((c) => c.kind === kind);
                  return (
                    <div key={kind} className="mb-2">
                      <div className="text-muted-foreground flex items-center gap-1.5 px-2.5 py-1 text-[12px]">
                        <Icon className="size-3 opacity-70" />
                        <span className="flex-1 font-medium">{meta.label}</span>
                      </div>
                      {items.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setActiveId(c.id)}
                          className={cn(
                            "hover:bg-muted/60 flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs",
                            activeId === c.id && "bg-muted text-foreground font-medium",
                          )}
                        >
                          <Layers className="text-muted-foreground size-3 shrink-0 opacity-60" />
                          <span className="min-w-0 flex-1 truncate font-mono" title={c.path}>
                            {c.name}
                            {c.kind === "instructions" ? ".md" : ".kcl"}
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {showCode ? (
            <div className="flex w-[min(42%,420px)] min-w-0 shrink-0 flex-col border-r">
              <div className="bg-card/60 flex h-9 shrink-0 items-center gap-2 border-b px-3">
                <span className="truncate font-mono text-xs font-medium" title={active.path}>
                  {active.name}
                  {active.kind === "instructions" ? ".md" : ".kcl"}
                </span>
                <span className="text-muted-foreground ml-auto text-[11px]">Autosaves</span>
              </div>
              <div className="min-h-0 flex-1">
                <Editor
                  key={`${monacoTheme}-${active.id}`}
                  language={isKcl ? "javascript" : "markdown"}
                  theme={monacoTheme}
                  beforeMount={defineFoundryMonacoThemes}
                  value={active.content}
                  options={{
                    readOnly: false,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    padding: { top: 10 },
                  }}
                />
              </div>
            </div>
          ) : null}

          <div className="bg-background relative min-w-0 flex-1">
            {active.kind === "instructions" ? (
              <div className="absolute inset-0 overflow-y-auto p-8">
                <article className="prose prose-sm dark:prose-invert mx-auto max-w-2xl font-sans text-sm leading-relaxed whitespace-pre-wrap">
                  {active.content}
                </article>
              </div>
            ) : (
              <>
                <CompanionViewport params={params} view={view} spin={spin} />

                {/* Viewport toolbar, matching the Zoo viewport chrome. */}
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-3 pt-3">
                  <div className="bg-card/95 pointer-events-auto flex items-center gap-0.5 rounded-none border px-1.5 py-1 shadow-lg backdrop-blur-md">
                    {VIEW_BUTTONS.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        title={v.label}
                        onClick={() => {
                          setView(v.id);
                          setSpin(false);
                        }}
                        className={cn(
                          "hover:bg-muted flex h-7 min-w-7 items-center justify-center rounded-none px-1 text-[10px] font-semibold",
                          view === v.id && !spin
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {v.label}
                      </button>
                    ))}
                    <span className="bg-border mx-1 h-4 w-px" />
                    <button
                      type="button"
                      title="Turntable"
                      onClick={() => setSpin((s) => !s)}
                      className={cn(
                        "hover:bg-muted flex h-7 items-center gap-1 rounded-none px-2 text-[10px] font-semibold",
                        spin ? "bg-muted text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <Play className="size-3" />
                      Turntable
                    </button>
                  </div>
                </div>

                <DemoParamsPanel params={params} onSet={setParam} />

                <div className="bg-card/90 text-muted-foreground pointer-events-none absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-none border px-2.5 py-1.5 text-[11px] shadow backdrop-blur-md">
                  <span className="text-foreground/85 font-medium">SIMULATED · mm · Y-up</span>
                  <span className="bg-border hidden h-3 w-px sm:block" />
                  <span className="hidden sm:inline">Orbit: drag</span>
                  <span className="hidden sm:inline">Pan: right-drag</span>
                  <span className="hidden sm:inline">Zoom: scroll</span>
                </div>

                {building ? (
                  <div
                    className="bg-card/95 pointer-events-none absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-none border px-3 py-1.5 text-xs shadow-lg backdrop-blur-md"
                    role="status"
                  >
                    <span className="bg-primary size-1.5 animate-pulse rounded-full" />
                    Building model
                  </div>
                ) : null}
              </>
            )}

            <div className="absolute top-3 left-3 z-30 flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setShowTree(!showTree)}
                aria-label={showTree ? "Hide component tree" : "Show component tree"}
                className="bg-card/90 shadow backdrop-blur-md"
              >
                {showTree ? (
                  <PanelLeftClose className="size-4" />
                ) : (
                  <PanelLeftOpen className="size-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setShowCode(!showCode)}
                aria-label={showCode ? "Hide code" : "Show code"}
                className={cn("bg-card/90 shadow backdrop-blur-md", showCode && "bg-muted")}
              >
                <Code className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
