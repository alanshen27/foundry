/**
 * The one place that reads a project's state for the fit check and the graph.
 *
 * Extracted from server/fit-check.ts so both can never disagree about what
 * they looked at. If the copilot's integration check says the project is clean
 * and the impact panel disagrees, the first thing anyone would suspect is that
 * they read different data — so they read the same data, once, here.
 */

import { prisma } from "@foundry/db";
import { normalizeCadDoc } from "@foundry/cad";
import { normalizeCircuitDoc } from "@/lib/circuit/catalog";
import { normalizePcbSet } from "@/lib/pcb/doc";
import type { GraphInput } from "@/lib/graph/derive";

/**
 * Everything the deriver and the checks need, in one round of queries.
 *
 * The selects are wider than the fit check strictly needs — ids, target paths
 * and the power fields — because those are exactly what a node addresses and
 * what the power budget is computed from. A narrower select here is what would
 * silently reduce the graph to a fraction of its edges.
 */
export async function gatherProjectState(projectId: string, branchId: string): Promise<GraphInput> {
  const where = { projectId, branchId };
  const [circuit, pcb, model3d, codeFiles, components, requirements, validationChecks] =
    await Promise.all([
      prisma.designDoc.findUnique({
        where: { projectId_branchId_kind: { projectId, branchId, kind: "CIRCUIT" } },
      }),
      prisma.designDoc.findUnique({
        where: { projectId_branchId_kind: { projectId, branchId, kind: "PCB" } },
      }),
      prisma.designDoc.findUnique({
        where: { projectId_branchId_kind: { projectId, branchId, kind: "MODEL3D" } },
      }),
      prisma.codeFile.findMany({ where, select: { id: true, path: true, content: true } }),
      prisma.component.findMany({
        where,
        select: {
          id: true,
          name: true,
          discipline: true,
          refDes: true,
          quantity: true,
          currentDrawMa: true,
          peakCurrentMa: true,
          nominalVoltageV: true,
          capacityMah: true,
          partNumber: true,
        },
      }),
      prisma.requirement.findMany({
        where,
        select: {
          id: true,
          title: true,
          priority: true,
          type: true,
          minValue: true,
          maxValue: true,
          unit: true,
          verificationMethod: true,
        },
      }),
      prisma.validationCheck.findMany({
        where,
        select: { id: true, title: true, targetPath: true },
      }),
    ]);

  const cad = model3d?.data ? normalizeCadDoc(model3d.data) : null;

  return {
    circuit: circuit?.data ? normalizeCircuitDoc(circuit.data) : null,
    pcb: pcb?.data ? normalizePcbSet(pcb.data) : null,
    codeFiles,
    components,
    // The KCL content comes along because assembly imports are what containment
    // is derived from, and the content hash is what detects a revision.
    cad: cad
      ? cad.components.map((c) => ({
          path: c.path,
          name: c.name,
          kind: c.kind,
          content: c.content,
        }))
      : [],
    requirements,
    validationChecks,
  };
}
