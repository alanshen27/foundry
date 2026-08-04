"use client";

/**
 * Single-window workspace. Surfaces that exist once per project — Assembly,
 * PCB, Checks, Repository, Ideate, Verify, Launch, Renders — are permanent
 * buttons in the top bar. Only CAD and Schematic open as closable tabs, since
 * those can have several components open side by side.
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

/** Windows the + menu can open as tabs — multi-component surfaces only. */
type OpenableKind = Exclude<EngineerDocKind, "assembly">;

const OPENABLE: { kind: OpenableKind; label: string; icon: typeof Boxes }[] = [
  { kind: "model", label: "CAD", icon: Boxes },
  { kind: "schematic", label: "Schematic", icon: Waypoints },
];

/** Single-instance surfaces pinned to the top bar. */
type FixedKind = Exclude<EngineerDocKind, "model" | "schematic">;

const FIXED: { kind: FixedKind; label: string; icon: typeof Boxes }[] = [
  { kind: "assembly", label: "Assembly", icon: Combine },
  { kind: "pcb", label: "PCB", icon: CircuitBoard },
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const partParam = searchParams.get("part");

  return (
    <EngineerDocWorkspace
      projectId={projectId}
      branchId={branchId}
      canEdit={canEdit}
      caps={caps}
      view={view}
      partParam={partParam}
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
  pathname,
  router,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
  caps: StageCaps;
  view: EngineerView;
  partParam: string | null;
  pathname: string;
  router: ReturnType<typeof useRouter>;
}) {
  const initial = useMemo(() => tabFromViewParam(view, partParam), [view, partParam]);

  // Only multi-component surfaces (CAD / Schematic) live in the tab strip;
  // fixed surfaces are top-bar buttons and mount lazily on first visit.
  const [tabs, setTabs] = useState<EngineerDocTab[]>(() =>
    FIXED_KINDS.has(initial.kind) ? [] : [initial],
  );
  const [activeKey, setActiveKey] = useState(initial.key);
  const [visitedFixed, setVisitedFixed] = useState<Set<string>>(
    () => new Set(["assembly", ...(FIXED_KINDS.has(initial.kind) ? [initial.key] : [])]),
  );
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    const next = tabFromViewParam(view, partParam);
    if (FIXED_KINDS.has(next.kind)) {
      setVisitedFixed((prev) => (prev.has(next.key) ? prev : new Set([...prev, next.key])));
    } else {
      setTabs((prev) => (prev.some((t) => t.key === next.key) ? prev : [...prev, next]));
    }
    setActiveKey(next.key);
  }, [view, partParam]);

  const syncUrl = useCallback(
    (tab: EngineerDocTab) => {
      const params = new URLSearchParams();
      params.set("view", viewParamForTab(tab));
      if (tab.kind === "model" && tab.componentId) params.set("part", tab.componentId);
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
    (kind: OpenableKind, opts?: { componentId?: string; label?: string }) => {
      if (FIXED_KINDS.has(kind)) {
        const key = tabKeyFor(kind);
        setVisitedFixed((prev) => (prev.has(key) ? prev : new Set([...prev, key])));
        setActiveKey(key);
        syncUrl({ key, kind, label: labelForKind(kind) });
        setNewOpen(false);
        return;
      }
      const key = tabKeyFor(kind, opts?.componentId);
      const tab: EngineerDocTab = {
        key,
        kind,
        label: opts?.label ?? labelForKind(kind),
        componentId: opts?.componentId,
      };
      setTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, tab]));
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
      syncUrl(kind === "assembly" ? ASSEMBLY_TAB : { key: kind, kind, label: labelForKind(kind) });
    },
    [syncUrl],
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
        }
      : ASSEMBLY_TAB);
  const hasModelTab = tabs.some((t) => t.kind === "model");
  const modelFocusId = useMemo(() => {
    if (active.kind === "model") return active.componentId;
    const lastModel = [...tabs].reverse().find((t) => t.kind === "model");
    return lastModel?.kind === "model" ? lastModel.componentId : undefined;
  }, [active, tabs]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-card/60 flex h-9 shrink-0 items-center border-b px-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {FIXED.map(({ kind, label, icon: Icon }) => (
            <button
              key={kind}
              type="button"
              onClick={() => activateFixed(kind)}
              aria-pressed={active.kind === kind}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-none px-2.5 text-xs",
                active.kind === kind
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              <Icon className="size-3" strokeWidth={2} />
              <span>{label}</span>
            </button>
          ))}
          {tabs.length > 0 ? (
            <span className="bg-border mx-1 h-4 w-px shrink-0" aria-hidden />
          ) : null}
          {tabs.map((tab) => (
            <div
              key={tab.key}
              className={cn(
                "group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-none px-2.5 text-xs",
                tab.key === active.key
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
              onClick={() => activate(tab)}
            >
              <TabIcon kind={tab.kind} />
              <span className="max-w-36 truncate">{tab.label}</span>
              {!tab.pinned ? (
                <button
                  type="button"
                  aria-label={`Close ${tab.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.key);
                  }}
                  className="hover:bg-muted-foreground/20 rounded p-0.5 opacity-0 group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div className="relative ml-0.5 shrink-0">
          <button
            type="button"
            aria-label="Open window"
            aria-haspopup="menu"
            aria-expanded={newOpen}
            onClick={() => setNewOpen((o) => !o)}
            className={cn(
              "text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 items-center justify-center rounded-none",
              newOpen && "bg-muted text-foreground",
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
                className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-1 min-w-44 overflow-hidden rounded-none border py-1 text-[13px] shadow-md"
              >
                {OPENABLE.map(({ kind, label, icon: Icon }) => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitem"
                    className="hover:bg-muted flex w-full items-center gap-2 px-3 py-1.5 text-left"
                    onClick={() => openTab(kind)}
                  >
                    <Icon className="size-3.5 opacity-70" />
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
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
                <PcbCanvas projectId={projectId} branchId={branchId} canEdit={canEdit} />
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
