import { notFound } from "next/navigation";
import { prisma } from "@foundry/db";
import { verifyRenderToken } from "@/server/render-token";
import { normalizePcbDoc } from "@/lib/pcb/doc";
import { EMPTY_CIRCUIT, normalizeCircuitDoc } from "@/lib/circuit/catalog";
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

  // The schematic comes along so the screenshot shows the ratsnest.
  const [doc, circuitDoc] = await Promise.all([
    prisma.designDoc.findUnique({
      where: {
        projectId_branchId_kind: {
          projectId: claims.projectId,
          branchId: claims.branchId,
          kind: "PCB",
        },
      },
    }),
    prisma.designDoc.findUnique({
      where: {
        projectId_branchId_kind: {
          projectId: claims.projectId,
          branchId: claims.branchId,
          kind: "CIRCUIT",
        },
      },
    }),
  ]);
  const pcb = normalizePcbDoc(doc?.data ?? null);
  const circuit = circuitDoc?.data ? normalizeCircuitDoc(circuitDoc.data) : EMPTY_CIRCUIT;

  return (
    <div className="bg-neutral-950 fixed inset-0">
      <PcbRenderView doc={pcb} circuit={circuit} />
    </div>
  );
}
