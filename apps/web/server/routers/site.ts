import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { slugify } from "@foundry/domain";
import { buildSiteSystemPrompt, type SiteProductContext } from "@foundry/sites";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireWorkspaceCapability } from "../access";
import { getSiteBuilder, isSiteBuilderConfigured } from "../sites";

const promptSchema = z.string().trim().min(1).max(2000);

/** Unique-per-workspace slug: `rover`, `rover-2`, `rover-3`, … */
async function uniqueSlug(workspaceId: string, name: string): Promise<string> {
  const base = slugify(name);
  const taken = await prisma.site.findMany({
    where: { workspaceId, slug: { startsWith: base } },
    select: { slug: true },
  });
  const used = new Set(taken.map((s) => s.slug));
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new TRPCError({ code: "CONFLICT", message: "Could not allocate a site slug" });
}

/**
 * Assembles the product-graph facts the builder is allowed to use. Without
 * this the generated page is a generic template; with it the copy is written
 * from real requirements, components, and verification state.
 */
async function loadProductContext(
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

export const siteRouter = router({
  /** Whether real generation is available, or everything will be SIMULATED. */
  builderStatus: protectedProcedure.query(() => ({ configured: isSiteBuilderConfigured() })),

  list: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireWorkspaceCapability(ctx.user.id, input.workspaceId, "project.read");
      return prisma.site.findMany({
        where: { workspaceId: input.workspaceId },
        include: { project: { select: { id: true, name: true, slug: true } } },
        orderBy: { updatedAt: "desc" },
      });
    }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const site = await prisma.site.findUnique({
      where: { id: input.id },
      include: { project: { select: { id: true, name: true, slug: true } } },
    });
    if (!site) throw new TRPCError({ code: "NOT_FOUND" });
    await requireWorkspaceCapability(ctx.user.id, site.workspaceId, "project.read");
    return site;
  }),

  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        projectId: z.string().optional(),
        name: z.string().trim().min(1).max(80),
        prompt: promptSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireWorkspaceCapability(
        ctx.user.id,
        input.workspaceId,
        "site.edit",
        input.projectId,
      );

      let releaseId: string | null = null;
      let system: string | undefined;
      if (input.projectId) {
        const project = await prisma.project.findUnique({
          where: { id: input.projectId },
          select: { workspaceId: true },
        });
        if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (project.workspaceId !== input.workspaceId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Project belongs to a different workspace",
          });
        }
        const loaded = await loadProductContext(input.projectId);
        releaseId = loaded.releaseId;
        system = buildSiteSystemPrompt(loaded.context);
      }

      const result = await getSiteBuilder().createSite(input.prompt, { system });
      if (!result.ok) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: result.error });
      }

      const site = await prisma.site.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId ?? null,
          releaseId,
          name: input.name,
          slug: await uniqueSlug(input.workspaceId, input.name),
          prompt: input.prompt,
          builderChatId: result.data.chatId,
          builderVersionId: result.data.versionId,
          previewUrl: result.data.previewUrl,
          builderUrl: result.data.builderUrl,
          simulated: result.data.simulated,
          createdById: ctx.user.id,
        },
      });

      await recordAudit({
        type: "SiteCreated",
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        actorId: ctx.user.id,
        payload: { siteId: site.id, slug: site.slug, simulated: site.simulated },
      });
      return site;
    }),

  revise: protectedProcedure
    .input(z.object({ id: z.string(), prompt: promptSchema }))
    .mutation(async ({ ctx, input }) => {
      const site = await prisma.site.findUnique({ where: { id: input.id } });
      if (!site) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(
        ctx.user.id,
        site.workspaceId,
        "site.edit",
        site.projectId ?? undefined,
      );

      const system = site.projectId
        ? buildSiteSystemPrompt((await loadProductContext(site.projectId)).context)
        : undefined;

      const result = await getSiteBuilder().reviseSite(site.builderChatId, input.prompt, {
        system,
      });
      if (!result.ok) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: result.error });
      }

      const updated = await prisma.site.update({
        where: { id: site.id },
        data: {
          prompt: input.prompt,
          builderVersionId: result.data.versionId,
          previewUrl: result.data.previewUrl,
          builderUrl: result.data.builderUrl ?? site.builderUrl,
          simulated: result.data.simulated,
        },
      });

      await recordAudit({
        type: "SiteRevised",
        workspaceId: site.workspaceId,
        projectId: site.projectId,
        actorId: ctx.user.id,
        payload: { siteId: site.id, versionId: result.data.versionId },
      });
      return updated;
    }),

  publish: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const site = await prisma.site.findUnique({ where: { id: input.id } });
      if (!site) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceCapability(
        ctx.user.id,
        site.workspaceId,
        "site.publish",
        site.projectId ?? undefined,
      );

      // SIMULATED output must never reach a public URL (AGENTS.md rule 3).
      if (site.simulated) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This site is SIMULATED and cannot be published. Set V0_API_KEY.",
        });
      }
      if (!site.builderVersionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This site has no generated revision to publish yet",
        });
      }

      const result = await getSiteBuilder().publishSite(site.builderChatId, site.builderVersionId);
      if (!result.ok) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: result.error });
      }

      const updated = await prisma.site.update({
        where: { id: site.id },
        data: { status: "PUBLISHED", publishedUrl: result.data.url },
      });

      await recordAudit({
        type: "SitePublished",
        workspaceId: site.workspaceId,
        projectId: site.projectId,
        actorId: ctx.user.id,
        payload: { siteId: site.id, url: result.data.url, deploymentId: result.data.id },
      });
      return updated;
    }),
});
