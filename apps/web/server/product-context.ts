import "server-only";
import { TRPCError } from "@trpc/server";
import { prisma } from "@foundry/db";
import type { SiteProductContext } from "@foundry/sites";
import type { MediaPromptContext } from "@foundry/media";

/**
 * Assembles the product-graph facts that generated artifacts (storefront
 * pages, marketing renders) are allowed to use. Without this a generated page
 * or render is generic; with it both are grounded in real requirements,
 * components, and verification state.
 */
export async function loadProductContext(
  projectId: string,
): Promise<{ context: SiteProductContext; releaseId: string | null }> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

  const branchId = project.activeBranchId;
  const [brief, requirements, components, verify, release] = await Promise.all([
    branchId
      ? prisma.projectBrief.findUnique({ where: { projectId_branchId: { projectId, branchId } } })
      : null,
    branchId
      ? prisma.requirement.findMany({
          where: { projectId, branchId },
          orderBy: { createdAt: "asc" },
          take: 40,
        })
      : [],
    branchId
      ? prisma.component.findMany({
          where: { projectId, branchId },
          orderBy: { createdAt: "asc" },
          take: 40,
        })
      : [],
    branchId
      ? prisma.stageState.findUnique({
          where: { projectId_branchId_stage: { projectId, branchId, stage: "VERIFY" } },
        })
      : null,
    prisma.release.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } }),
  ]);

  const context: SiteProductContext = {
    productName: project.name,
    summary: brief?.intendedUse ?? project.description ?? null,
    releaseVersion: release?.version ?? null,
    verified: verify?.status === "APPROVED",
    requirements: requirements.map((r) => {
      const range = [r.minValue, r.maxValue].filter((v) => v !== null).join("–");
      const measured = range ? `${range}${r.unit ? ` ${r.unit}` : ""}` : null;
      return { label: r.title, detail: r.description ?? measured };
    }),
    components: components.map((c) => ({
      name: [c.manufacturer, c.name, c.partNumber].filter(Boolean).join(" "),
      quantity: c.quantity,
    })),
  };
  return { context, releaseId: release?.id ?? null };
}

/**
 * Narrows the site context to what an image/video generator should see: form
 * and interface facts only. Quantities and internal part numbers do not help a
 * renderer and invite it to draw labels.
 */
export function toMediaPromptContext(context: SiteProductContext): MediaPromptContext {
  return {
    productName: context.productName,
    summary: context.summary ?? null,
    formNotes: (context.requirements ?? [])
      .slice(0, 12)
      .map((r) => (r.detail ? `${r.label}: ${r.detail}` : r.label)),
    components: (context.components ?? []).slice(0, 12).map((c) => c.name),
    verified: context.verified,
  };
}
