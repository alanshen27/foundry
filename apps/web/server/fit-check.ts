/**
 * Gathers everything the cross-stage fit check needs and evaluates it.
 *
 * The evaluation itself is pure (lib/integration/fit-check.ts); this is the one
 * place that reads the project, so the copilot's tool and the Verify panel can
 * never disagree about what was checked.
 */

import { prisma } from "@foundry/db";
import { normalizeCadDoc } from "@foundry/cad";
import { normalizeCircuitDoc } from "@/lib/circuit/catalog";
import { normalizePcbSet } from "@/lib/pcb/doc";
import { evaluateFit, type FitReport } from "@/lib/integration/fit-check";

export async function runFitCheck(projectId: string, branchId: string): Promise<FitReport> {
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
      prisma.codeFile.findMany({ where, select: { path: true, content: true } }),
      prisma.component.findMany({
        where,
        select: { name: true, discipline: true, refDes: true },
      }),
      prisma.requirement.findMany({ where, select: { title: true, priority: true } }),
      prisma.validationCheck.findMany({ where, select: { title: true } }),
    ]);

  const cad = model3d?.data ? normalizeCadDoc(model3d.data) : null;

  return evaluateFit({
    circuit: circuit?.data ? normalizeCircuitDoc(circuit.data) : null,
    pcb: pcb?.data ? normalizePcbSet(pcb.data) : null,
    codeFiles,
    components,
    cad: cad ? cad.components.map((c) => ({ path: c.path, name: c.name, kind: c.kind })) : [],
    requirements,
    validationChecks,
  });
}
