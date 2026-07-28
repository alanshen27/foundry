import { notFound } from "next/navigation";
import { prisma } from "@foundry/db";
import { verifyRenderToken } from "@/server/render-token";
import { normalizePcbSet } from "@/lib/pcb/doc";
import { EMPTY_CIRCUIT, normalizeCircuitDoc } from "@/lib/circuit/catalog";
import { circuitForGroup } from "@/lib/circuit/groups";
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
  // Screenshots show the active board, and only its slice of the schematic —
  // a sibling board's parts are not this board's problem.
  const set = normalizePcbSet(doc?.data ?? null);
  const pcb = set.boards.find((b) => b.id === set.activeBoardId) ?? set.boards[0]!;
  const whole = circuitDoc?.data ? normalizeCircuitDoc(circuitDoc.data) : EMPTY_CIRCUIT;
  const circuit = circuitForGroup(whole, pcb.groupId ?? null);

  return (
    <div className="bg-neutral-950 fixed inset-0">
      <PcbRenderView doc={pcb} circuit={circuit} />
    </div>
  );
}
