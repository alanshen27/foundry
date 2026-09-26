"use client";

import { useState, useSyncExternalStore } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import {
  buildLinkedAssembly,
  stableCadHash,
  type CadAssemblyInstance,
  type CadDoc,
} from "@foundry/cad";
import type { AppRouter } from "@/server/routers/_app";
import type { CircuitDoc } from "@/lib/circuit/catalog";
import { emptyPcbDoc, normalizePcbSet, type PcbSet } from "@/lib/pcb/doc";
import { pcbCadPartName, pcbCadPartPath, pcbPartKcl } from "@/lib/pcb/kcl";
import { pcbMechanicalSourceHash } from "@/lib/pcb/mechanical";
import { buildEngineeringReadiness, type EngineeringTarget } from "@/lib/engineering/readiness";
import { CadDraftStore } from "@/lib/copilot/cad-draft";
import { CadDraftProvider } from "@/components/copilot/cad-draft-context";
import { PcbCanvas } from "@/components/engineer/pcb-canvas";
import { EngineeringWorkflow } from "@/components/engineer/engineering-workflow";
import { LiveCadDrafts } from "@/components/engineer/live-cad-drafts";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

// Empty scope disables presence and collaboration transports in this local-only fixture.
const SCOPE = { projectId: "", branchId: "" };

function createFixture() {
  const circuit: CircuitDoc = {
    version: 2,
    parts: [
      { id: "led-main", type: "wokwi-led", label: "LED1", x: 30, y: 30 },
      {
        id: "resistor-main",
        type: "wokwi-resistor",
        label: "R1",
        attrs: { value: "220" },
        x: 130,
        y: 30,
      },
      { id: "controller-main", type: "wokwi-esp32-devkit-v1", label: "U1", x: 230, y: 30 },
      { id: "led-aux", type: "wokwi-led", label: "LED2", x: 630, y: 30 },
    ],
    wires: [
      {
        id: "anode",
        from: { part: "led-main", pin: "A" },
        to: { part: "resistor-main", pin: "1" },
        label: "LED_SUPPLY",
      },
      {
        id: "cathode",
        from: { part: "led-main", pin: "C" },
        to: { part: "resistor-main", pin: "2" },
        label: "RETURN",
      },
    ],
    groups: [
      { id: "main-region", label: "Main", x: 0, y: 0, w: 500, h: 400 },
      { id: "aux-region", label: "Auxiliary", x: 600, y: 0, w: 300, h: 400 },
    ],
  };
  let pcb: PcbSet = {
    version: 2,
    boards: [
      {
        ...emptyPcbDoc(),
        id: "main-board",
        name: "Main board",
        groupId: "main-region",
        footprints: [
          {
            id: "footprint-led",
            libraryId: "LED_0805",
            refDes: "LED1",
            xMm: 20,
            yMm: 20,
            rotationDeg: 0,
            side: "front",
          },
          {
            id: "footprint-resistor",
            libraryId: "R_0603",
            refDes: "R1",
            partId: "resistor-main",
            xMm: 40,
            yMm: 20,
            rotationDeg: 90,
            side: "back",
            bodyHeightMm: 0.5,
          },
        ],
        tracks: [
          {
            id: "existing-track",
            layer: "B.Cu",
            widthMm: 0.3,
            net: "RETURN",
            points: [
              { xMm: 40, yMm: 20.75 },
              { xMm: 45, yMm: 20.75 },
            ],
          },
        ],
      },
      {
        ...emptyPcbDoc(),
        id: "aux-board",
        name: "Auxiliary board",
        groupId: "aux-region",
        board: { widthMm: 36, heightMm: 24, thicknessMm: 1.2, cornerRadiusMm: 2 },
        footprints: [
          {
            id: "footprint-aux",
            libraryId: "LED_0805",
            refDes: "LED2",
            partId: "led-aux",
            xMm: 12,
            yMm: 12,
            rotationDeg: 0,
            side: "front",
            bodyHeightMm: 1.1,
          },
        ],
      },
    ],
  };
  let cad: CadDoc = { version: 5, engine: "zoo", components: [], activeId: "", script: "" };
  let revision = 0;
  const calls: { path: string; input: unknown }[] = [];
  const listeners = new Set<() => void>();
  const status = () => ({
    fingerprint: `local-${revision}`,
    report: buildEngineeringReadiness({ circuit, pcb, cad: cad.components.length ? cad : null }),
    canSyncCad: true,
    canBuildAssembly: true,
    cad,
  });
  const changed = () => {
    revision += 1;
    listeners.forEach((listener) => listener());
  };
  const dispatch = (path: string, input: unknown): unknown => {
    const args = input as Record<string, unknown> | undefined;
    if (path === "project.viewer") return null;
    if (path === "comments.list" || path === "verify.listChecks") return [];
    if (path === "design.aiEditLock") return null;
    if (path === "engineering.status") return status();
    if (path === "design.get")
      return {
        id: `fixture-${args?.kind}`,
        ...SCOPE,
        kind: args?.kind,
        data: args?.kind === "CIRCUIT" ? circuit : args?.kind === "PCB" ? pcb : cad,
      };
    if (path === "design.save") {
      if (args?.kind !== "PCB") throw new Error("Only fixture PCB edits are supported");
      calls.push({ path, input });
      pcb = normalizePcbSet(args.data);
      changed();
      return { id: "fixture-PCB", ...SCOPE, kind: "PCB", data: pcb };
    }
    if (path === "engineering.syncPcbToCad" || path === "engineering.buildAssembly") {
      if (args?.expectedFingerprint !== status().fingerprint)
        throw new Error("Fixture changed; refresh before updating");
      calls.push({ path, input });
      if (path === "engineering.syncPcbToCad") {
        cad = {
          ...cad,
          components: pcb.boards.map((board) => {
            const name = pcbCadPartName(board);
            const content = pcbPartKcl(board);
            return {
              id: `cad-${board.id}`,
              name: board.name || "PCB board",
              path: pcbCadPartPath(name),
              kind: "part" as const,
              content,
              source: {
                kind: "pcb" as const,
                boardId: board.id!,
                sourceHash: pcbMechanicalSourceHash(board),
                generatedHash: stableCadHash(content),
              },
            };
          }),
        };
        cad.activeId = cad.components[0]?.id ?? "";
        cad.script = cad.components[0]?.content ?? "";
      } else {
        cad = buildLinkedAssembly(cad, args?.instances as CadAssemblyInstance[] | undefined);
      }
      changed();
      return status();
    }
    throw new Error(`No local fixture response for ${path}`);
  };
  const link: TRPCLink<AppRouter> =
    () =>
    ({ op }) =>
      observable((observer) => {
        queueMicrotask(() => {
          try {
            observer.next({ result: { data: dispatch(op.path, op.input) } });
            observer.complete();
          } catch (error) {
            observer.error(TRPCClientError.from(error as Error));
          }
        });
      });
  return {
    link,
    snapshot: () => ({ pcb, cad, calls }),
    revision: () => revision,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Real product components with an isolated transport for manual and browser testing. */
export function EngineeringLab() {
  const [fixture] = useState(createFixture);
  const [queries] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [client] = useState(() => trpc.createClient({ links: [fixture.link] }));
  const [drafts] = useState(() => new CadDraftStore());
  const [target, setTarget] = useState<EngineeringTarget>({ view: "pcb", boardId: "main-board" });
  useSyncExternalStore(fixture.subscribe, fixture.revision, () => 0);
  return (
    <trpc.Provider client={client} queryClient={queries}>
      <QueryClientProvider client={queries}>
        <CadDraftProvider value={drafts}>
          <main className="relative flex h-screen min-h-[700px] flex-col bg-background text-foreground">
            <header className="flex items-center justify-between gap-4 border-b px-4 py-3">
              <div>
                <h1 className="text-sm font-semibold">Engineering lab · LOCAL / UNVERIFIED</h1>
                <p className="text-xs text-muted-foreground">
                  Two-board fixture. Changes stay in this tab and reset on reload.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    drafts.set({
                      toolCallId: "fixture",
                      clear: false,
                      path: "parts/enclosure.kcl",
                      content: "// LOCAL live draft; not saved\nwidth = 42\nheight = ",
                      truncated: false,
                    })
                  }
                >
                  Show live draft
                </Button>
                <Button size="sm" variant="ghost" onClick={() => drafts.clearAll()}>
                  Clear live draft
                </Button>
              </div>
            </header>
            <EngineeringWorkflow {...SCOPE} onNavigate={setTarget} />
            <div className="px-4 py-1 text-[11px] text-muted-foreground" role="status">
              Selected view: {target.view}
            </div>
            <div className="relative flex min-h-0 flex-1">
              <PcbCanvas {...SCOPE} canEdit focusBoardId={target.boardId} />
              <LiveCadDrafts />
            </div>
            <details className="border-t px-4 text-xs">
              <summary>Local fixture state</summary>
              <pre data-testid="engineering-lab-state" className="max-h-32 overflow-auto">
                {JSON.stringify(fixture.snapshot())}
              </pre>
            </details>
          </main>
        </CadDraftProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
