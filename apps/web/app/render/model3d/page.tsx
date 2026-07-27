import { notFound } from "next/navigation";
import { prisma } from "@foundry/db";
import { verifyRenderToken } from "@/server/render-token";
import {
  buildKclProject,
  getActiveComponent,
  normalizeCadDoc,
  parseKclModuleImports,
} from "@/lib/cad/engine";
import { getZooEngineToken } from "@/server/cad";
import { ModelRenderView } from "@/components/engineer/model-render-view";
import type { CadView } from "@/components/engineer/cad-viewport";

/**
 * Headless render target for 3D model screenshots (copilot vision loop).
 * Access is via a short-lived signed token minted by the render tools.
 */
export default async function ModelRenderPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; view?: string }>;
}) {
  const { token, view } = await searchParams;
  const claims = token ? verifyRenderToken(token) : null;
  if (!claims || claims.kind !== "model3d") notFound();

  const doc = await prisma.designDoc.findUnique({
    where: {
      projectId_branchId_kind: {
        projectId: claims.projectId,
        branchId: claims.branchId,
        kind: "MODEL3D",
      },
    },
  });
  const cad = normalizeCadDoc(doc?.data ?? null);
  const cadView = (["iso", "front", "top", "right"] as const).includes(view as never)
    ? (view as CadView)
    : "iso";

  // Assemblies import their parts, so they only render as a multi-file submit.
  // Screenshotting the flattened mirror script showed the agent an empty scene.
  const active = getActiveComponent(cad);
  const project =
    active && parseKclModuleImports(active.content).length > 0
      ? buildKclProject(cad, active.path)
      : null;

  let engineToken = "";
  try {
    engineToken = getZooEngineToken();
  } catch {
    engineToken = "";
  }

  return (
    <div className="bg-background fixed inset-0">
      <ModelRenderView
        script={active?.content ?? cad.script}
        view={cadView}
        engineToken={engineToken}
        engineBaseUrl="https://api.zoo.dev"
        projectFiles={project?.files}
        entryPath={project?.entryPath}
      />
    </div>
  );
}
