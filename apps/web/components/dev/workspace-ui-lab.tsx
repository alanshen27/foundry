"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { UIMessage, UIMessageChunk } from "ai";
import { buildLinkedAssembly, type CadDoc } from "@foundry/cad";
import type { AppRouter } from "@/server/routers/_app";
import { ProjectShell } from "@/components/project-shell";
import { EngineerStage, type EngineerView } from "@/components/stages/engineer-stage";
import { BackgroundChatTransport } from "@/lib/copilot/background-chat-transport";
import { buildEngineeringReadiness } from "@/lib/engineering/readiness";
import { emptyPcbDoc } from "@/lib/pcb/doc";
import { trpc } from "@/lib/trpc";
import { WorkspaceUiPreviewContext } from "./workspace-ui-preview";
import { recorderFixtureMesh } from "./workspace-ui-mesh";

// Empty scope disables cursor and Yjs rooms. All tRPC calls stay in the local link below.
const SCOPE = { projectId: "", branchId: "" };
const VIEWER = { id: "local-ui-reviewer", name: "Alex Morgan", avatarUrl: null };
const WORKSPACE = { id: "", name: "Hardware studio", slug: "local-ui-fixture" };
const CHANNEL = { id: "local-workspace-ui", name: "Design", categoryId: null, sortOrder: 0 };
const VIEWS: EngineerView[] = [
  "assembly",
  "model",
  "pcb",
  "schematic",
  "checks",
  "code",
  "ideate",
  "verify",
  "launch",
  "renders",
];
const MESSAGES: UIMessage[] = [
  {
    id: "local-brief",
    role: "user",
    metadata: { authorUserId: VIEWER.id, authorName: VIEWER.name },
    parts: [
      {
        type: "text",
        text: "@AI Refine the recorder into a compact MagSafe accessory. Keep the record button tactile and make the assembly easy to service.",
      },
    ],
  },
  {
    id: "local-work",
    role: "assistant",
    parts: [
      {
        type: "tool-get_project_state",
        toolCallId: "local-state",
        state: "output-available",
        input: {},
        output: { summary: "LOCAL fixture: project brief and saved components reviewed." },
      },
      {
        type: "tool-text_to_cad",
        toolCallId: "local-cad",
        state: "output-available",
        input: { prompt: "Refine the recorder enclosure" },
        output: { summary: "SIMULATED UI sample: enclosure, button and diffuser." },
      },
      {
        type: "text",
        text: "The design is ready for review. The exploded view shows the housing, electronics and magnetic mounting ring.\n\n- 64 mm enclosure with a recessed record button\n- Separate top and base for service access\n- PCB and battery kept inside the mounting footprint\n\n**LOCAL / UNVERIFIED sample.** Check clearances and retention before fabrication.",
      },
    ],
  },
];

class PreviewChatTransport extends BackgroundChatTransport {
  override async sendMessages(): Promise<ReadableStream<UIMessageChunk>> {
    throw new Error("LOCAL UI fixture: sending messages and starting AI jobs are disabled.");
  }
  override async reconnectToStream(): Promise<null> {
    return null;
  }
  override async waitForPendingEnqueues(): Promise<void> {}
}

function createFixture() {
  const parts = [
    { id: "base", name: "Lower housing", radius: 32, height: 5 },
    { id: "top", name: "Upper housing", radius: 32, height: 2.5 },
    { id: "button", name: "Record button", radius: 7, height: 1.7 },
    { id: "diffuser", name: "Light diffuser", radius: 3, height: 0.6 },
    { id: "magnet", name: "MagSafe ring", radius: 26, height: 1.5 },
  ];
  const seed: CadDoc = {
    version: 5,
    engine: "build123d",
    activeId: "base",
    script: "",
    components: parts.map((part) => ({
      id: part.id,
      name: part.name,
      path: `parts/${part.id}/main.py`,
      kind: "part",
      content: `# LOCAL UI fixture part: ${part.id}\n# SIMULATED geometry, not engineering evidence\nfrom build123d import Cylinder\nradius = ${part.radius}\nheight = ${part.height}\nresult = Cylinder(radius, height)\n`,
    })),
  };
  seed.script = seed.components[0]!.content;
  const cad = buildLinkedAssembly(seed);
  const circuit = {
    version: 2,
    groups: [],
    wires: [],
    parts: [
      { id: "controller", type: "wokwi-esp32-devkit-v1", label: "U1", x: 60, y: 70 },
      { id: "indicator", type: "wokwi-led", label: "D1", x: 250, y: 90 },
      { id: "record-switch", type: "wokwi-pushbutton", label: "SW1", x: 380, y: 90 },
    ],
  };
  const pcb = {
    version: 2,
    boards: [
      {
        ...emptyPcbDoc(),
        id: "recorder-pcb",
        name: "Recorder PCB",
        board: { widthMm: 48, heightMm: 42, thicknessMm: 1.6, cornerRadiusMm: 5 },
        footprints: [
          {
            id: "controller-package",
            libraryId: "QFN-16-3x3",
            refDes: "U1",
            partId: "controller",
            xMm: 20,
            yMm: 20,
            rotationDeg: 0,
            side: "front",
          },
          {
            id: "indicator-package",
            libraryId: "LED_0805",
            refDes: "D1",
            partId: "indicator",
            xMm: 34,
            yMm: 12,
            rotationDeg: 0,
            side: "front",
          },
        ],
      },
    ],
  };
  const bom = [
    { id: "bom-controller", name: "Audio controller", quantity: 1, unitCostCents: 480 },
    { id: "bom-battery", name: "Rechargeable battery", quantity: 1, unitCostCents: 390 },
    { id: "bom-housing", name: "Enclosure set", quantity: 1, unitCostCents: 640 },
    { id: "bom-magnet", name: "Magnetic mounting ring", quantity: 1, unitCostCents: 210 },
  ];
  const checks = [
    {
      id: "check-fit",
      title: "PCB clearance and connector access",
      detail: "LOCAL sample check. Physical fit has not been verified.",
      category: "CROSS_DOMAIN",
      severity: "WARNING",
      status: "PENDING",
      waived: false,
      targetPath: "assembly/product.py",
    },
    {
      id: "check-retention",
      title: "Magnetic retention force",
      detail: "Measure with the assembled device and intended phone case.",
      category: "MECHANICAL",
      severity: "WARNING",
      status: "PENDING",
      waived: false,
      targetPath: null,
    },
  ];
  const dispatch = (path: string, input: unknown): unknown => {
    const args = input as Record<string, unknown> | undefined;
    if (path === "project.viewer") return VIEWER;
    if (
      path === "chat.activeRun" ||
      path === "design.aiEditLock" ||
      path.startsWith("collaboration.")
    )
      return null;
    if (
      path === "comments.list" ||
      path === "launch.listReleases" ||
      path === "engineer.listRepos" ||
      path === "code.listFiles" ||
      path === "ideate.listRequirements"
    )
      return [];
    if (path === "engineer.listComponents") return bom;
    if (path === "verify.listChecks") return checks;
    if (path === "ideate.getBrief")
      return {
        title: "MagSafe meeting recorder",
        problem: "Capture clear meeting audio with one tactile control.",
        audience: "People who work across meeting rooms and shared spaces.",
        constraints: "64 mm footprint; serviceable enclosure; rechargeable battery.",
        successCriteria: "Fast recording access, clear status, reliable attachment.",
        summary: "LOCAL / UNVERIFIED sample project.",
      };
    if (path === "cad.measure")
      return { unit: "mm", center: { x: 0, y: 0, z: 2.5 }, dimensions: { x: 64, y: 64, z: 5 } };
    if (path === "design.get")
      return {
        id: `local-${args?.kind}`,
        ...SCOPE,
        kind: args?.kind,
        data: args?.kind === "MODEL3D" ? cad : args?.kind === "PCB" ? pcb : circuit,
      };
    if (path === "engineering.status")
      return {
        fingerprint: "local-workspace-ui-v1",
        report: buildEngineeringReadiness({ cad, pcb, circuit, components: bom }),
        canSyncCad: false,
        canBuildAssembly: false,
        cad,
      };
    if (path === "chat.messages")
      return MESSAGES.map((message) => ({
        ...message,
        authorUserId: message.role === "user" ? VIEWER.id : null,
        authorName: message.role === "user" ? VIEWER.name : null,
        authorAvatarUrl: null,
        replyToId: null,
        replyPreview: null,
        editedAt: null,
        deletedAt: null,
        reactions: [],
        createdAt: "2026-09-11T09:00:00.000Z",
      }));
    if (path === "chat.persistMessages") return { ok: true, count: 0 };
    throw new Error(`LOCAL UI fixture: ${path} is disabled; no data was changed.`);
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
  const meshes = new Map<string, Uint8Array<ArrayBuffer>>();
  const preview = {
    chatTransport: new PreviewChatTransport({ ...SCOPE, channelId: CHANNEL.id }),
    meshResponse: async (requestBody: string) => {
      const request = JSON.parse(requestBody) as { script: string; entryPath?: string };
      const part = request.entryPath?.startsWith("assembly/")
        ? undefined
        : /^# LOCAL UI fixture part: (\w+)/m.exec(request.script)?.[1];
      const key = part ?? "assembly";
      if (!meshes.has(key)) meshes.set(key, recorderFixtureMesh(part));
      return new Response(meshes.get(key)!, {
        headers: { "Content-Type": "model/gltf-binary", "X-Cad-Up-Axis": "z", "X-Cad-Unit": "mm" },
      });
    },
  };
  return { link, preview };
}

/** Real workspace UI, synthetic data and local geometry; no service credentials are used. */
export function WorkspaceUiLab() {
  const [fixture] = useState(createFixture);
  const [queries] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [client] = useState(() => trpc.createClient({ links: [fixture.link] }));
  const params = useSearchParams();
  const selected = params.get("view") as EngineerView | null;
  const view = selected && VIEWS.includes(selected) ? selected : "assembly";
  const caps = useMemo(
    () => ({
      canEditIdeate: false,
      canRunVerify: false,
      canApproveVerify: false,
      canCreateRelease: false,
      canEditMedia: false,
      canApproveMedia: false,
      verifyStatus: "DRAFT",
    }),
    [],
  );
  return (
    <WorkspaceUiPreviewContext.Provider value={fixture.preview}>
      <trpc.Provider client={client} queryClient={queries}>
        <QueryClientProvider client={queries}>
          <ProjectShell
            workspaces={[WORKSPACE]}
            workspace={WORKSPACE}
            project={{ id: "", name: "MagSafe meeting recorder", slug: "local-recorder" }}
            branchId=""
            branchName="LOCAL / UNVERIFIED"
            stageStatuses={{ IDEATE: "DRAFT", ENGINEER: "DRAFT", VERIFY: "DRAFT", LAUNCH: "DRAFT" }}
            user={VIEWER}
            chatChannels={[CHANNEL]}
            chatCategories={[]}
            defaultChannelId={CHANNEL.id}
            initialChatMessages={MESSAGES}
          >
            <EngineerStage {...SCOPE} canEdit={false} view={view} caps={caps} />
          </ProjectShell>
        </QueryClientProvider>
      </trpc.Provider>
    </WorkspaceUiPreviewContext.Provider>
  );
}
