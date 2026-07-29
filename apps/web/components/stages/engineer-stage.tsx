"use client";

/**
 * Engineer workspace: Assembly is the pinned home viewport. CAD / Schematic /
 * PCB open via the + dropdown as closable top tabs. Repository lives in the
 * process footer (`?view=code`) as its own full surface.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Boxes, CircuitBoard, Combine, Plus, Waypoints, X } from "lucide-react";
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

const CodeWorkspace = dynamic(
  () => import("@/components/engineer/code-workspace").then((m) => m.CodeWorkspace),
  {
    ssr: false,
    loading: () => <DotMatrixLoader className="absolute inset-0" label="Loading code" />,
  },
);

/** Views the stage page may still pass (legacy deep links). */
export type EngineerView =
  "sourcing" | "schematic" | "pcb" | "model" | "code" | "design" | "assembly";

type Props = {
  projectId: string;
  branchId: string;
  canEdit: boolean;
  view: EngineerView;
};

/** Windows the + menu can open inside Engineer (not Repository — that is a footer tab). */
type OpenableKind = "model" | "schematic" | "pcb";

const OPENABLE: { kind: OpenableKind; label: string; icon: typeof Boxes }[] = [
  { kind: "model", label: "CAD", icon: Boxes },
  { kind: "schematic", label: "Schematic", icon: Waypoints },
  { kind: "pcb", label: "PCB", icon: CircuitBoard },
];

function TabIcon({ kind }: { kind: Exclude<EngineerDocKind, "code"> }) {
  if (kind === "assembly") return <Combine className="size-3" strokeWidth={2} />;
  if (kind === "model") return <Boxes className="size-3" strokeWidth={2} />;
  if (kind === "pcb") return <CircuitBoard className="size-3" strokeWidth={2} />;
  return <Waypoints className="size-3" strokeWidth={2} />;
}

export function EngineerStage({ projectId, branchId, canEdit, view }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const partParam = searchParams.get("part");

  // Repository is a process-footer peer, not an Engineer document tab.
  if (view === "code") {
    return (
      <div className="relative h-full overflow-hidden">
        <CodeWorkspace projectId={projectId} branchId={branchId} canEdit={canEdit} />
      </div>
    );
  }

  return (
    <EngineerDocWorkspace
      projectId={projectId}
      branchId={branchId}
      canEdit={canEdit}
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
  view,
  partParam,
  pathname,
  router,
}: {
  projectId: string;
  branchId: string;
  canEdit: boolean;
  view: Exclude<EngineerView, "code">;
  partParam: string | null;
  pathname: string;
  router: ReturnType<typeof useRouter>;
}) {
  const initial = useMemo(() => tabFromViewParam(view, partParam), [view, partParam]);

  const [tabs, setTabs] = useState<EngineerDocTab[]>(() =>
    initial.key === "assembly" ? [ASSEMBLY_TAB] : [ASSEMBLY_TAB, initial],
  );
  const [activeKey, setActiveKey] = useState(initial.key);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    const next = tabFromViewParam(view, partParam);
    if (next.kind === "code") return;
    setTabs((prev) => {
      if (prev.some((t) => t.key === next.key)) return prev;
      return [...prev, next];
    });
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

  const closeTab = useCallback(
    (key: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.key !== key || t.kind === "assembly");
        if (activeKey === key) {
          const fallback = next[next.length - 1] ?? ASSEMBLY_TAB;
          setActiveKey(fallback.key);
          syncUrl(fallback);
        }
        return next;
      });
    },
    [activeKey, syncUrl],
  );

  const active = tabs.find((t) => t.key === activeKey) ?? ASSEMBLY_TAB;
  const mountedKeys = useMemo(() => new Set(tabs.map((t) => t.key)), [tabs]);
  const hasModelTab = tabs.some((t) => t.kind === "model");
  const modelFocusId = useMemo(() => {
    if (active.kind === "model") return active.componentId;
    const lastModel = [...tabs].reverse().find((t) => t.kind === "model");
    return lastModel?.kind === "model" ? lastModel.componentId : undefined;
  }, [active, tabs]);

  const docTabs = tabs.filter((t) => t.kind !== "code");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-card/60 flex h-9 shrink-0 items-center border-b px-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {docTabs.map((tab) => (
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
              <TabIcon kind={tab.kind as Exclude<EngineerDocKind, "code">} />
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
        {mountedKeys.has("assembly") ? (
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
          .filter((t) => t.kind === "pcb" || t.kind === "schematic")
          .map((tab) => (
            <div
              key={tab.key}
              className={cn(
                "absolute inset-0",
                active.key === tab.key ? "z-10" : "pointer-events-none invisible z-0",
              )}
              aria-hidden={active.key !== tab.key}
            >
              {tab.kind === "pcb" ? (
                <PcbCanvas projectId={projectId} branchId={branchId} canEdit={canEdit} />
              ) : null}
              {tab.kind === "schematic" ? (
                <CircuitCanvas projectId={projectId} branchId={branchId} canEdit={canEdit} />
              ) : null}
            </div>
          ))}
      </div>
    </div>
  );
}
