import { notFound } from "next/navigation";
import { prisma } from "@foundry/db";
import { verifyRenderToken } from "@/server/render-token";
import { normalizeCircuitDoc } from "@/lib/circuit/catalog";
import { CircuitRenderView } from "@/components/engineer/circuit-render-view";

/**
 * Headless render target for circuit screenshots (copilot vision loop).
 * Access is via a short-lived signed token minted by the render tools.
 */
export default async function CircuitRenderPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const claims = token ? verifyRenderToken(token) : null;
  if (!claims || claims.kind !== "circuit") notFound();

  const doc = await prisma.designDoc.findUnique({
    where: {
      projectId_branchId_kind: {
        projectId: claims.projectId,
        branchId: claims.branchId,
        kind: "CIRCUIT",
      },
    },
  });
  const circuit = normalizeCircuitDoc(doc?.data ?? null);

  return (
    <div className="bg-background fixed inset-0">
      <CircuitRenderView doc={circuit} />
    </div>
  );
}
