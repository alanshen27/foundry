import { notFound } from "next/navigation";
import { prisma } from "@foundry/db";
import { verifyRenderToken } from "@/server/render-token";
import { getActiveComponent, normalizeCadDoc, pickCadAssemblyPreview } from "@/lib/cad/engine";
import { cadViewportInput } from "@/lib/cad/viewport-project";
import { ModelRenderView } from "@/components/engineer/model-render-view";
import type { CadView } from "@/components/engineer/cad-viewport";

/**
 * Headless render target for 3D model screenshots (copilot vision loop).
 * Access is via a short-lived signed token minted by the render tools.
 */
export default async function ModelRenderPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; view?: string; tight?: string }>;
}) {
  const { token, view, tight } = await searchParams;
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

  // Prefer the product assembly for screenshots — activeId may still point at a
  // part the agent last edited, which hides assembly import failures.
  const active = pickCadAssemblyPreview(cad)?.component ?? getActiveComponent(cad);
  const viewport = active ? cadViewportInput(cad, active.id) : null;

  return (
    <div className="bg-background fixed inset-0">
      <ModelRenderView
        script={viewport?.script ?? active?.content ?? cad.script}
        engine={viewport?.engine}
        view={cadView}
        projectId={claims.projectId}
        renderToken={token}
        meshAssets={viewport?.meshAssets}
        projectFiles={viewport?.projectFiles}
        entryPath={viewport?.entryPath}
        tight={tight === "1"}
      />
    </div>
  );
}
