import { notFound } from "next/navigation";
import { prisma } from "@foundry/db";
import { verifyRenderToken } from "@/server/render-token";
import { normalizePcbDoc } from "@/lib/pcb/doc";
import { PcbRenderView } from "@/components/engineer/pcb-render-view";

/**
 * Headless render target for PCB screenshots (copilot vision loop).
 */
export default async function PcbRenderPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const claims = token ? verifyRenderToken(token) : null;
  if (!claims || claims.kind !== "pcb") notFound();

  const doc = await prisma.designDoc.findUnique({
    where: {
      projectId_branchId_kind: {
        projectId: claims.projectId,
        branchId: claims.branchId,
        kind: "PCB",
      },
    },
  });
  const pcb = normalizePcbDoc(doc?.data ?? null);

  return (
    <div className="bg-neutral-950 fixed inset-0">
      <PcbRenderView doc={pcb} />
    </div>
  );
}
