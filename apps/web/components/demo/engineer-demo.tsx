"use client";

/**
 * SIMULATED Engineer workspace for demo recordings (/demo/engineer).
 *
 * Replays a scripted copilot run end-to-end with local, hardcoded data —
 * no auth, no DB, no Zoo engine: the chat sidebar streams a user prompt,
 * thinking row, assistant answer and tool calls, while the CAD tree fills
 * in and the 3D model builds up stage-by-stage in a local three.js
 * viewport. Everything shown is SIMULATED, never verified.
 */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  Boxes,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  CircuitBoard,
  Code,
  Combine,
  FileText,
  FolderGit2,
  Images,
  LayoutDashboard,
  Layers,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Puzzle,
  RotateCcw,
  Rocket,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Waypoints,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DotMatrixLoader } from "@/components/dot-matrix-loader";
import { FoundryMark } from "@/components/foundry-mark";
import { InteractiveDotField } from "@/components/interactive-dot-field";
import { useTheme } from "@/components/theme-provider";
import { defineFoundryMonacoThemes } from "@/lib/monaco-theme";
import { monacoThemeFor } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  DEFAULT_COMPANION_PARAMS,
  type CompanionParams,
  type CompanionView,
} from "@/components/demo/companion-viewport";
import { DemoChatSidebar, type DemoChatItem } from "@/components/demo/demo-chat-sidebar";

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

/**
 * Scripted copilot run: each step mutates the chat feed / model stage on a
 * delay after the previous one, so the whole page replays like a recording.
 */
type ScriptStep = { after: number; apply: (s: DemoScriptApi) => void };

type DemoScriptApi = {
  push: (item: DemoChatItem) => void;
  finishTool: (id: string, detail?: string) => void;
  setBusy: (b: boolean) => void;
  setModelStage: (n: number) => void;
  setEngineBusy: (b: boolean) => void;
  revealComponents: (ids: string[]) => void;
  setSpin: (b: boolean) => void;
};

const USER_PROMPT =
  "@AI I would like to build an e-ink desk companion that shows my calendar, tasks and the weather. Model it.";

const SCRIPT: ScriptStep[] = [
  {
    after: 1200,
    apply: (s) => s.push({ kind: "user", id: "u1", author: "alan", text: USER_PROMPT }),
  },
  { after: 500, apply: (s) => s.setBusy(true) },
  {
    after: 2200,
    apply: (s) =>
      s.push({
        kind: "assistant-text",
        id: "a1",
        text: "On it — I'll model the desk companion now: enclosure, e-ink display module and kickstand as manufacturing parts, then wire them into the product assembly for the preview.",
      }),
  },
  {
    after: 2600,
    apply: (s) => s.push({ kind: "tool", id: "t1", name: "get_project_state", state: "running" }),
  },
  { after: 1100, apply: (s) => s.finishTool("t1") },
  {
    after: 600,
    apply: (s) => {
      s.push({ kind: "tool", id: "t2", name: "text_to_cad", state: "running" });
      s.setEngineBusy(true);
    },
  },
  {
    after: 3000,
    apply: (s) => {
      s.finishTool("t2", "3 parts in parallel · 2,841 chars KCL");
      s.revealComponents(["enclosure", "display-module", "kickstand"]);
      s.setEngineBusy(false);
      s.setModelStage(1);
    },
  },
  {
    after: 900,
    apply: (s) => {
      s.push({ kind: "tool", id: "t3", name: "add_part_to_assembly", state: "running" });
      s.setEngineBusy(true);
    },
  },
  {
    after: 1400,
    apply: (s) => {
      s.setEngineBusy(false);
      s.setModelStage(2);
    },
  },
  { after: 1400, apply: (s) => s.setModelStage(3) },
  {
    after: 900,
    apply: (s) => {
      s.finishTool("t3", "3 mfg refs · assembly/product.kcl");
      s.revealComponents(["product", "assembly-guide"]);
    },
  },
  {
    after: 900,
    apply: (s) => {
      s.push({
        kind: "assistant-text",
        id: "a2",
        text: 'Done — assembly/product.kcl renders the finished companion: tilted enclosure, 7.5" e-ink dashboard, rotary encoder and kickstand. Tweak the parameters panel (standAngle, bodyWidth…) and the model rebuilds live.',
      });
      s.setBusy(false);
      s.setSpin(true);
    },
  },
];

function ProcessFooterDemo() {
  const steps = [
    { label: "Overview", icon: LayoutDashboard, active: false },
    { label: "Ideation", icon: Lightbulb, active: false, dot: "bg-emerald-500" },
    { label: "Engineer", icon: Combine, active: true, dot: "bg-primary animate-pulse" },
    { label: "Repository", icon: FolderGit2, active: false },
    { label: "Verify", icon: ShieldCheck, active: false, dot: "bg-muted-foreground/35" },
    { label: "Launch", icon: Rocket, active: false, dot: "bg-muted-foreground/35" },
    { label: "Renders", icon: Images, active: false, dot: "bg-muted-foreground/35" },
  ];
  return (
    <footer className="bg-card flex h-10 shrink-0 items-center border-t px-1">
      <nav aria-label="Design process" className="flex h-full min-w-0 flex-1 items-stretch gap-0.5">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <button
              key={step.label}
              type="button"
              className={cn(
                "group relative flex items-center gap-1.5 rounded-none px-2.5 text-[12px] font-medium transition-colors sm:px-3",
                step.active
                  ? "bg-phase-engineer/10 text-phase-engineer"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {step.active ? (
                <span
                  aria-hidden
                  className="bg-phase-engineer absolute inset-x-2 top-0 h-0.5 rounded-full"
                />
              ) : null}
              <Icon className="size-3.5 opacity-80" strokeWidth={1.75} />
              <span className="hidden md:inline">{step.label}</span>
              {step.dot ? <span className={cn("size-1.5 rounded-full", step.dot)} /> : null}
            </button>
          );
        })}
      </nav>
      <span className="text-muted-foreground flex size-8 items-center justify-center rounded-none">
        <Settings className="size-3.5" strokeWidth={1.75} />
      </span>
    </footer>
  );
}

export function EngineerDemo() {
  const { theme } = useTheme();
  const monacoTheme = monacoThemeFor(theme.mode);

  const [activeId, setActiveId] = useState("product");
  const [showTree, setShowTree] = useState(true);
  const [showCode, setShowCode] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [params, setParams] = useState<CompanionParams>(DEFAULT_COMPANION_PARAMS);
  const [view, setView] = useState<CompanionView>("iso");
  const [spin, setSpin] = useState(false);
  const [building, setBuilding] = useState(false);

  // Scripted run state.
  const [chatItems, setChatItems] = useState<DemoChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [modelStage, setModelStage] = useState(0);
  const [engineBusy, setEngineBusy] = useState(false);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [runId, setRunId] = useState(0);
  const noteCounter = useRef(0);

  useEffect(() => {
    const api: DemoScriptApi = {
      push: (item) => setChatItems((prev) => [...prev, item]),
      finishTool: (id, detail) =>
        setChatItems((prev) =>
          prev.map((it) =>
            it.kind === "tool" && it.id === id ? { ...it, state: "done", detail } : it,
          ),
        ),
      setBusy,
      setModelStage,
      setEngineBusy,
      revealComponents: (ids) => setVisibleIds((prev) => [...prev, ...ids]),
      setSpin,
    };
    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = 0;
    for (const step of SCRIPT) {
      at += step.after;
      timers.push(setTimeout(() => step.apply(api), at));
    }
    return () => timers.forEach(clearTimeout);
  }, [runId]);

  function replay() {
    setChatItems([]);
    setBusy(false);
    setModelStage(0);
    setEngineBusy(false);
    setVisibleIds([]);
    setSpin(false);
    setView("iso");
    setParams(DEFAULT_COMPANION_PARAMS);
    setActiveId("product");
    setRunId((n) => n + 1);
  }

  const active: DemoComponent = useMemo(
    () => COMPONENTS.find((c) => c.id === activeId) ?? ENCLOSURE_COMPONENT,
    [activeId],
  );
  const isKcl = active.kind !== "instructions";
  const visibleComponents = COMPONENTS.filter((c) => visibleIds.includes(c.id));

  function setParam(key: keyof CompanionParams, value: number | boolean) {
    setParams((prev) => ({ ...prev, [key]: value }));
    // Brief "Building model" pulse so edits read like a real engine rebuild.
    setBuilding(true);
    setTimeout(() => setBuilding(false), 650);
  }

  return (
    <div className="bg-background fixed inset-0 flex flex-col overflow-hidden">
      {/* Project header, matching the real ProjectShell breadcrumb bar. */}
      <header className="bg-card relative z-20 flex h-11 shrink-0 items-center gap-1.5 border-b px-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
          <span className="text-foreground flex size-5 shrink-0 items-center justify-center">
            <FoundryMark size="sm" showWord={false} />
          </span>
          <span className="text-border flex h-5 items-center text-[13px] leading-none" aria-hidden>
            /
          </span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex h-5 items-center gap-1 text-[13px] leading-none transition-colors"
          >
            <span className="truncate leading-none">esap workspace</span>
            <ChevronsUpDown className="size-3 shrink-0 opacity-70" />
          </button>
          <span className="text-border flex h-5 items-center text-[13px] leading-none" aria-hidden>
            /
          </span>
          <span className="text-foreground flex h-5 max-w-52 items-center truncate text-[13px] leading-none font-medium">
            e-ink desk companion
          </span>
          <span className="bg-muted text-muted-foreground ml-0.5 flex h-5 items-center rounded-none px-1.5 font-mono text-[11px] leading-none">
            main
          </span>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="bg-primary/10 text-primary shrink-0 rounded-none px-2 py-0.5 text-[10px] font-semibold tracking-wide">
            SIMULATED DEMO
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={replay}
            aria-label="Replay demo"
            title="Replay demo"
          >
            <RotateCcw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setChatOpen(!chatOpen)}
            aria-label={chatOpen ? "Hide copilot" : "Show copilot"}
          >
            {chatOpen ? (
              <PanelRightClose className="size-4" />
            ) : (
              <PanelRightOpen className="size-4" />
            )}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="pointer-events-none absolute inset-0">
            <InteractiveDotField gap={16} radius={52} />
          </div>

          {/* Document tab bar (Assembly pinned + CAD), like the Engineer stage. */}
          <div className="bg-card/60 relative z-10 flex h-9 shrink-0 items-center border-b px-1">
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
          </div>

          <div className="relative z-10 min-h-0 flex-1">
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
                      const items = visibleComponents.filter((c) => c.kind === kind);
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
                          {items.length === 0 ? (
                            <p className="text-muted-foreground px-2.5 py-1 text-[11px]">
                              None yet
                            </p>
                          ) : null}
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
                {active.kind === "instructions" && visibleIds.includes("assembly-guide") ? (
                  <div className="absolute inset-0 overflow-y-auto p-8">
                    <article className="prose prose-sm dark:prose-invert mx-auto max-w-2xl font-sans text-sm leading-relaxed whitespace-pre-wrap">
                      {active.content}
                    </article>
                  </div>
                ) : (
                  <>
                    <CompanionViewport params={params} view={view} spin={spin} stage={modelStage} />

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

                    {modelStage > 0 ? <DemoParamsPanel params={params} onSet={setParam} /> : null}

                    <div className="bg-card/90 text-muted-foreground pointer-events-none absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-none border px-2.5 py-1.5 text-[11px] shadow backdrop-blur-md">
                      <span className="text-foreground/85 font-medium">SIMULATED · mm · Y-up</span>
                      <span className="bg-border hidden h-3 w-px sm:block" />
                      <span className="hidden sm:inline">Orbit: drag</span>
                      <span className="hidden sm:inline">Pan: right-drag</span>
                      <span className="hidden sm:inline">Zoom: scroll</span>
                    </div>

                    {engineBusy ? (
                      <DotMatrixLoader
                        className="pointer-events-none absolute inset-0 z-30"
                        tone="signal"
                        label="Building model in Zoo engine"
                      />
                    ) : null}

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
        </main>

        {chatOpen ? (
          <DemoChatSidebar
            items={chatItems}
            busy={busy}
            onSendNote={(text) => {
              noteCounter.current += 1;
              setChatItems((prev) => [
                ...prev,
                { kind: "user", id: `note-${noteCounter.current}`, author: "alan", text },
              ]);
            }}
          />
        ) : null}
      </div>

      <ProcessFooterDemo />
    </div>
  );
}
