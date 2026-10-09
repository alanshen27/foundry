"use client";

/**
 * Single-page workspace. Assembly is the home surface. Other documents open
 * as closable tabs from the window menu; Cmd+K still jumps anywhere.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Boxes,
  CircuitBoard,
  Combine,
  FolderGit2,
  Images,
  Lightbulb,
  Package,
  Plus,
  Rocket,
  ShieldCheck,
  Waypoints,
  X,
} from "lucide-react";
import {
  ASSEMBLY_TAB,
  labelForKind,
  tabFromViewParam,
  tabKeyFor,
  viewParamForTab,
  type EngineerDocKind,
  type EngineerDocTab,
} from "@/lib/engineer-tabs";
import { cn } from "@/lib/utils";
import { DotMatrixLoader } from "@/components/dot-matrix-loader";
import { EngineeringWorkflow } from "@/components/engineer/engineering-workflow";
import { LiveCadDrafts } from "@/components/engineer/live-cad-drafts";
import type { EngineeringTarget } from "@/lib/engineering/readiness";

const CircuitCanvas = dynamic(
  () => import("@/components/engineer/circuit-canvas").then((m) => m.CircuitCanvas),
  {
    ssr: false,
    loading: () => <DotMatrixLoader className="absolute inset-0" label="Loading schematic" />,
  },
);

const ModelEditor = dynamic(
  () => import("@/components/engineer/model-editor").then((m) => m.ModelEditor),
  {
    ssr: false,
    loading: () => <DotMatrixLoader className="absolute inset-0" label="Loading CAD" />,
  },
);

const AssemblyView = dynamic(
  () => import("@/components/engineer/assembly-view").then((m) => m.AssemblyView),
  {
    ssr: false,
    loading: () => <DotMatrixLoader className="absolute inset-0" label="Loading assembly" />,
  },
);

const PcbCanvas = dynamic(
  () => import("@/components/engineer/pcb-canvas").then((m) => m.PcbCanvas),
  {
    ssr: false,
    loading: () => <DotMatrixLoader className="absolute inset-0" label="Loading PCB" />,
  },
);

const SourcingPanel = dynamic(
  () => import("@/components/engineer/sourcing-panel").then((m) => m.SourcingPanel),
  { ssr: false, loading: () => <DotMatrixLoader label="Loading sourcing" /> },
);

const ChecksPanel = dynamic(
  () => import("@/components/engineer/checks-panel").then((m) => m.ChecksPanel),
  {
    ssr: false,
    loading: () => <DotMatrixLoader className="absolute inset-0" label="Loading checks" />,
  },
);

const CodeWorkspace = dynamic(
  () => import("@/components/engineer/code-workspace").then((m) => m.CodeWorkspace),
  {
    ssr: false,
    loading: () => <DotMatrixLoader className="absolute inset-0" label="Loading code" />,
  },
);

const IdeateStage = dynamic(
  () => import("@/components/stages/ideate-stage").then((m) => m.IdeateStage),
  {
    ssr: false,
    loading: () => <DotMatrixLoader className="absolute inset-0" label="Loading ideation" />,
  },
);

const VerifyStage = dynamic(
  () => import("@/components/stages/verify-stage").then((m) => m.VerifyStage),
  {
    ssr: false,
    loading: () => <DotMatrixLoader className="absolute inset-0" label="Loading verification" />,
  },
);

const LaunchStage = dynamic(
  () => import("@/components/stages/launch-stage").then((m) => m.LaunchStage),
  {
    ssr: false,
    loading: () => <DotMatrixLoader className="absolute inset-0" label="Loading launch" />,
  },
);

/** Views the stage page may still pass (legacy deep links). */
export type EngineerView =
  | "sourcing"
  | "schematic"
  | "pcb"
  | "model"
  | "code"
  | "design"
  | "assembly"
  | "checks"
  | "ideate"
  | "verify"
  | "launch"
  | "renders";

/** Capabilities the stage tabs need (computed server-side). */
export type StageCaps = {
  canEditIdeate: boolean;
  canRunVerify: boolean;
  canApproveVerify: boolean;
  canCreateRelease: boolean;
  canEditMedia: boolean;
  canApproveMedia: boolean;
  verifyStatus: string;
};

type Props = {
  projectId: string;
  branchId: string;
  canEdit: boolean;
  view: EngineerView;
  caps: StageCaps;
};

/** Anything except Assembly can be opened as a closable tab. */
type OpenableKind = Exclude<EngineerDocKind, "assembly">;

const OPENABLE: { kind: OpenableKind; label: string; icon: typeof Boxes }[] = [
  { kind: "model", label: "CAD", icon: Boxes },
  { kind: "schematic", label: "Schematic", icon: Waypoints },
  { kind: "pcb", label: "PCB", icon: CircuitBoard },
  { kind: "sourcing", label: "Sourcing", icon: Package },
  { kind: "checks", label: "Checks", icon: ShieldCheck },
  { kind: "code", label: "Repository", icon: FolderGit2 },
  { kind: "ideate", label: "Ideate", icon: Lightbulb },
  { kind: "verify", label: "Verify", icon: ShieldCheck },
  { kind: "launch", label: "Launch", icon: Rocket },
  { kind: "renders", label: "Renders", icon: Images },
];

/** Surfaces that mount once and stay warm after the first visit. */
type FixedKind = Exclude<EngineerDocKind, "model" | "schematic">;

const FIXED: { kind: FixedKind; label: string; icon: typeof Boxes }[] = [
  { kind: "assembly", label: "Assembly", icon: Combine },
  { kind: "pcb", label: "PCB", icon: CircuitBoard },
  { kind: "sourcing", label: "Sourcing", icon: Package },
  { kind: "checks", label: "Checks", icon: ShieldCheck },
  { kind: "code", label: "Repository", icon: FolderGit2 },
  { kind: "ideate", label: "Ideate", icon: Lightbulb },
  { kind: "verify", label: "Verify", icon: ShieldCheck },
  { kind: "launch", label: "Launch", icon: Rocket },
  { kind: "renders", label: "Renders", icon: Images },
];

const FIXED_KINDS = new Set<EngineerDocKind>(FIXED.map((f) => f.kind));

function TabIcon({ kind }: { kind: EngineerDocKind }) {
  if (kind === "assembly") return <Combine className="size-3" strokeWidth={2} />;
  if (kind === "model") return <Boxes className="size-3" strokeWidth={2} />;
  if (kind === "pcb") return <CircuitBoard className="size-3" strokeWidth={2} />;
  if (kind === "sourcing") return <Package className="size-3" strokeWidth={2} />;
  if (kind === "checks") return <ShieldCheck className="size-3" strokeWidth={2} />;
  if (kind === "code") return <FolderGit2 className="size-3" strokeWidth={2} />;
  if (kind === "ideate") return <Lightbulb className="size-3" strokeWidth={2} />;
  if (kind === "verify") return <ShieldCheck className="size-3" strokeWidth={2} />;
  if (kind === "launch") return <Rocket className="size-3" strokeWidth={2} />;
  if (kind === "renders") return <Images className="size-3" strokeWidth={2} />;
  return <Waypoints className="size-3" strokeWidth={2} />;
}

/** Centered-document surfaces (Ideate / Verify / Launch) inside a scrollable tab pane. */
function DocumentPane({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background/60 h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl p-6 lg:p-8">{children}</div>
    </div>
  );
}

export function EngineerStage({ projectId, branchId, canEdit, view, caps }: Props) {
  useEffect(() => {
    if (projectId)
      document.cookie = `foundry-last-project=${encodeURIComponent(projectId)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }, [projectId]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const partParam = searchParams.get("part");
  const boardParam = searchParams.get("board");

  return (
    <EngineerDocWorkspace
      projectId={projectId}
      branchId={branchId}
      canEdit={canEdit}
      caps={caps}
      view={view}
      partParam={partParam}
      boardParam={boardParam}
      pathname={pathname}
      router={router}
    />
  );
}

function EngineerDocWorkspace({
  projectId,
  branchId,
  canEdit,
  caps,
  view,
  partParam,
  boardParam,
  pathname,
  router,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
  caps: StageCaps;
  view: EngineerView;
  partParam: string | null;
  boardParam: string | null;
  pathname: string;
  router: ReturnType<typeof useRouter>;
}) {
  const initial = useMemo(
    () => tabFromViewParam(view, partParam, boardParam),
    [view, partParam, boardParam],
  );

  const [tabs, setTabs] = useState<EngineerDocTab[]>(() =>
    initial.kind === "assembly" ? [] : [initial],
  );
  const [activeKey, setActiveKey] = useState(initial.key);
  const [visitedFixed, setVisitedFixed] = useState<Set<string>>(
    () => new Set(["assembly", ...(FIXED_KINDS.has(initial.kind) ? [initial.key] : [])]),
  );
  const [newOpen, setNewOpen] = useState(false);
  const [pcbBoardId, setPcbBoardId] = useState<string | undefined>(
    initial.kind === "pcb" ? initial.boardId : undefined,
  );

  useEffect(() => {
    const next = tabFromViewParam(view, partParam, boardParam);
    if (FIXED_KINDS.has(next.kind)) {
      setVisitedFixed((prev) => (prev.has(next.key) ? prev : new Set([...prev, next.key])));
      if (next.kind === "pcb" && next.boardId) setPcbBoardId(next.boardId);
    }
    if (next.kind !== "assembly") {
      setTabs((prev) => (prev.some((t) => t.key === next.key) ? prev : [...prev, next]));
    }
    setActiveKey(next.key);
  }, [view, partParam, boardParam]);

  const syncUrl = useCallback(
    (tab: EngineerDocTab) => {
      const params = new URLSearchParams();
      params.set("view", viewParamForTab(tab));
      if (tab.kind === "model" && tab.componentId) params.set("part", tab.componentId);
      if (tab.kind === "pcb" && tab.boardId) params.set("board", tab.boardId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router],
  );

  const activate = useCallback(
    (tab: EngineerDocTab) => {
      setActiveKey(tab.key);
      syncUrl(tab);
    },
    [syncUrl],
  );

  const openTab = useCallback(
    (kind: OpenableKind, opts?: { componentId?: string; boardId?: string; label?: string }) => {
      if (kind === "pcb" && opts?.boardId) setPcbBoardId(opts.boardId);
      if (FIXED_KINDS.has(kind)) {
        const mounted = tabKeyFor(kind);
        setVisitedFixed((prev) => (prev.has(mounted) ? prev : new Set([...prev, mounted])));
      }
      const key = tabKeyFor(kind, opts?.componentId);
      const tab: EngineerDocTab = {
        key,
        kind,
        label: opts?.label ?? labelForKind(kind),
        componentId: opts?.componentId,
        boardId: opts?.boardId,
        pinned: false,
      };
      setTabs((prev) =>
        prev.some((t) => t.key === key)
          ? prev.map((existing) =>
              existing.key === key ? { ...existing, ...tab, pinned: false as const } : existing,
            )
          : [...prev, tab],
      );
      setActiveKey(key);
      syncUrl(tab);
      setNewOpen(false);
    },
    [syncUrl],
  );

  const activateFixed = useCallback(
    (kind: FixedKind) => {
      setVisitedFixed((prev) => (prev.has(kind) ? prev : new Set([...prev, kind])));
      setActiveKey(kind);
      syncUrl(
        kind === "assembly"
          ? ASSEMBLY_TAB
          : {
              key: kind,
              kind,
              label: labelForKind(kind),
              ...(kind === "pcb" && pcbBoardId ? { boardId: pcbBoardId } : {}),
            },
      );
    },
    [pcbBoardId, syncUrl],
  );

  const closeTab = useCallback(
    (key: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.key !== key);
        if (activeKey === key) {
          const fallback = next[next.length - 1];
          setActiveKey(fallback?.key ?? "assembly");
          syncUrl(fallback ?? ASSEMBLY_TAB);
        }
        return next;
      });
    },
    [activeKey, syncUrl],
  );

  const active: EngineerDocTab =
    tabs.find((t) => t.key === activeKey) ??
    (activeKey !== "assembly" && FIXED_KINDS.has(activeKey as EngineerDocKind)
      ? {
          key: activeKey,
          kind: activeKey as Exclude<EngineerDocKind, "assembly">,
          label: labelForKind(activeKey as EngineerDocKind),
          ...(activeKey === "pcb" && pcbBoardId ? { boardId: pcbBoardId } : {}),
        }
      : ASSEMBLY_TAB);
  const hasModelTab = tabs.some((t) => t.kind === "model");
  const modelFocusId = useMemo(() => {
    if (active.kind === "model") return active.componentId;
    const lastModel = [...tabs].reverse().find((t) => t.kind === "model");
    return lastModel?.kind === "model" ? lastModel.componentId : undefined;
  }, [active, tabs]);

  const navigateWorkflow = useCallback(
    (target: EngineeringTarget) => {
      if (target.view === "assembly") activate(ASSEMBLY_TAB);
      else openTab(target.view, { componentId: target.componentId, boardId: target.boardId });
    },
    [activate, openTab],
  );

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <EngineeringWorkflow
        projectId={projectId}
        branchId={branchId}
        onNavigate={navigateWorkflow}
      />
      <div className="bg-card/60 flex h-9 shrink-0 items-center border-b px-1">
        <nav
          aria-label="Open documents"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          <button
            type="button"
            onClick={() => activateFixed("assembly")}
            aria-current={active.kind === "assembly" ? "page" : undefined}
            aria-pressed={active.kind === "assembly"}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-none px-2.5 text-xs",
              active.kind === "assembly"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            <Combine className="size-3" strokeWidth={2} />
            <span>Assembly</span>
          </button>
          {tabs.length > 0 ? (
            <span className="bg-border mx-1 h-4 w-px shrink-0" aria-hidden />
          ) : null}
          {tabs.map((tab) => (
            <div
              key={tab.key}
              className={cn(
                "group relative flex h-9 shrink-0 items-center border-b-2 font-mono text-[10px] tracking-[0.08em] uppercase",
                tab.key === active.key
                  ? "border-primary bg-primary/5 text-primary"
                  : "text-muted-foreground hover:bg-muted/40 border-transparent",
              )}
            >
              <button
                type="button"
                onClick={() => activate(tab)}
                aria-current={tab.key === active.key ? "page" : undefined}
                aria-pressed={tab.key === active.key}
                className="focus-visible:outline-ring flex h-full items-center gap-1.5 px-2.5 outline-offset-[-3px]"
              >
                <TabIcon kind={tab.kind} />
                <span className="max-w-36 truncate">{tab.label}</span>
              </button>
              {!tab.pinned ? (
                <button
                  type="button"
                  aria-label={`Close ${tab.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.key);
                  }}
                  className="hover:bg-muted focus-visible:opacity-100 mr-1.5 rounded-none p-0.5 opacity-50 group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          ))}
        </nav>

        <div className="relative ml-1 shrink-0">
          <button
            type="button"
            aria-label="Open window"
            aria-haspopup="menu"
            aria-expanded={newOpen}
            onClick={() => setNewOpen((o) => !o)}
            className={cn(
              "text-primary hover:bg-primary/10 flex size-7 items-center justify-center rounded-none",
              newOpen && "bg-primary/10",
            )}
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
          {newOpen ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Close menu"
                onClick={() => setNewOpen(false)}
              />
              <div
                role="menu"
                aria-label="Open window"
                className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-1 min-w-44 overflow-hidden rounded-none border py-1 font-mono text-[11px] tracking-[0.08em] uppercase shadow-none"
              >
                {OPENABLE.map(({ kind, label, icon: Icon }) => (
                  <div key={kind}>
                    {kind === "sourcing" || kind === "ideate" ? (
                      <div className="bg-border my-1 h-px" aria-hidden />
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="hover:bg-muted flex w-full items-center gap-2 px-3 py-1.5 text-left"
                      onClick={() => openTab(kind)}
                    >
                      <Icon className="size-3.5 opacity-70" />
                      {label}
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <LiveCadDrafts />
        {visitedFixed.has("assembly") ? (
          <div
            className={cn(
              "absolute inset-0",
              active.kind === "assembly" ? "z-10" : "pointer-events-none invisible z-0",
            )}
            aria-hidden={active.kind !== "assembly"}
          >
            <AssemblyView
              projectId={projectId}
              branchId={branchId}
              onOpenEditor={(target) => {
                if (target === "pcb") openTab("pcb");
                else if (target === "schematic") openTab("schematic");
                else if (target.editor === "pcb")
                  openTab("pcb", { boardId: target.boardId, label: "PCB" });
                else
                  openTab("model", {
                    componentId: target.componentId,
                    label: target.label ?? "CAD",
                  });
              }}
            />
          </div>
        ) : null}

        {hasModelTab ? (
          <div
            className={cn(
              "absolute inset-0",
              active.kind === "model" ? "z-10" : "pointer-events-none invisible z-0",
            )}
            aria-hidden={active.kind !== "model"}
          >
            <ModelEditor
              projectId={projectId}
              branchId={branchId}
              canEdit={canEdit}
              focusComponentId={modelFocusId}
              onOpenComponent={({ id, name }) => openTab("model", { componentId: id, label: name })}
            />
          </div>
        ) : null}

        {tabs
          .filter((t) => t.kind === "schematic")
          .map((tab) => (
            <div
              key={tab.key}
              className={cn(
                "absolute inset-0",
                active.key === tab.key ? "z-10" : "pointer-events-none invisible z-0",
              )}
              aria-hidden={active.key !== tab.key}
            >
              <CircuitCanvas projectId={projectId} branchId={branchId} canEdit={canEdit} />
            </div>
          ))}

        {FIXED.filter(({ kind }) => kind !== "assembly" && visitedFixed.has(kind)).map(
          ({ kind }) => (
            <div
              key={kind}
              className={cn(
                "absolute inset-0",
                active.kind === kind ? "z-10" : "pointer-events-none invisible z-0",
              )}
              aria-hidden={active.kind !== kind}
            >
              {kind === "pcb" ? (
                <PcbCanvas
                  projectId={projectId}
                  branchId={branchId}
                  canEdit={canEdit}
                  focusBoardId={pcbBoardId}
                />
              ) : null}
              {kind === "sourcing" ? (
                <DocumentPane>
                  <SourcingPanel projectId={projectId} branchId={branchId} canEdit={canEdit} />
                </DocumentPane>
              ) : null}
              {kind === "checks" ? <ChecksPanel projectId={projectId} branchId={branchId} /> : null}
              {kind === "code" ? (
                <div className="relative h-full overflow-hidden">
                  <CodeWorkspace projectId={projectId} branchId={branchId} canEdit={canEdit} />
                </div>
              ) : null}
              {kind === "ideate" ? (
                <DocumentPane>
                  <IdeateStage
                    projectId={projectId}
                    branchId={branchId}
                    canEdit={caps.canEditIdeate}
                  />
                </DocumentPane>
              ) : null}
              {kind === "verify" ? (
                <DocumentPane>
                  <VerifyStage
                    projectId={projectId}
                    branchId={branchId}
                    canRun={caps.canRunVerify}
                    canApprove={caps.canApproveVerify}
                    verifyStatus={caps.verifyStatus}
                  />
                </DocumentPane>
              ) : null}
              {kind === "launch" || kind === "renders" ? (
                <DocumentPane>
                  <LaunchStage
                    projectId={projectId}
                    branchId={branchId}
                    canCreate={caps.canCreateRelease}
                    verifyApproved={caps.verifyStatus === "APPROVED"}
                    canEditMedia={caps.canEditMedia}
                    canApproveMedia={caps.canApproveMedia}
                    canEditGraph={canEdit}
                    view={kind === "renders" ? "renders" : "releases"}
                  />
                </DocumentPane>
              ) : null}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
