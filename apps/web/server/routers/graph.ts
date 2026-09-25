import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireProjectCapability } from "../access";
import { diffGraphs } from "@/lib/graph/compare";
import { impactFrom, provenanceOf } from "@/lib/graph/impact";
import { AUTHORED_ONLY_EDGE_KINDS, PRODUCT_EDGE_KINDS } from "@/lib/graph/types";
import { loadGraphSnapshot, syncProductGraph } from "../graph/sync";
import { markImpacted, markNodeReviewed } from "../graph/stale";

const scope = z.object({ projectId: z.string(), branchId: z.string() });
const refKey = z.string().trim().min(3).max(300);
const edgeKind = z.enum(PRODUCT_EDGE_KINDS);

/** Resolves a node by refKey within a branch, or 404s. */
async function nodeByRefKey(projectId: string, branchId: string, key: string) {
  const node = await prisma.productNode.findUnique({
    where: { projectId_branchId_refKey: { projectId, branchId, refKey: key } },
  });
  if (!node) {
    throw new TRPCError({ code: "NOT_FOUND", message: `No graph node for ${key}` });
  }
  return node;
}

export const graphRouter = router({
  /** The whole graph for a branch. Empty until the first sync. */
  snapshot: protectedProcedure.input(scope).query(async ({ ctx, input }) => {
    await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
    return loadGraphSnapshot(input.projectId, input.branchId);
  }),

  /**
   * Just the flagged nodes, for the badges scattered across the BOM,
   * requirement and check tables. Deliberately narrow: those tables render on
   * every tab switch and have no use for the edges.
   */
  staleNodes: protectedProcedure.input(scope).query(async ({ ctx, input }) => {
    await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
    return prisma.productNode.findMany({
      where: {
        projectId: input.projectId,
        branchId: input.branchId,
        staleAt: { not: null },
        reviewedAt: null,
      },
      select: {
        id: true,
        refKey: true,
        refId: true,
        kind: true,
        label: true,
        staleAt: true,
        staleReason: true,
        staleDepth: true,
        staleConfidence: true,
      },
      orderBy: { staleAt: "desc" },
    });
  }),

  /** What a change to this node would affect, with the path that explains why. */
  impact: protectedProcedure
    .input(
      scope.extend({
        refKey,
        maxDepth: z.number().int().min(1).max(10).optional(),
        minConfidence: z.number().min(0).max(1).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      const graph = await loadGraphSnapshot(input.projectId, input.branchId);
      return {
        root: graph.nodes.find((n) => n.refKey === input.refKey) ?? null,
        impacted: impactFrom(graph, input.refKey, {
          maxDepth: input.maxDepth,
          minConfidence: input.minConfidence,
        }),
      };
    }),

  /**
   * What changed between two branches of the same project — added, removed
   * and changed nodes and edges, across every domain the graph indexes.
   *
   * Read-only: it does not sync either branch first. Forcing a sync on every
   * open would spam `syncProductGraph`'s own audit log as a side effect of a
   * read; the caller (the compare panel) syncs explicitly, the same way the
   * impact panel already does when a snapshot comes back empty.
   */
  compareBranches: protectedProcedure
    .input(z.object({ projectId: z.string(), branchAId: z.string(), branchBId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      const [a, b] = await Promise.all([
        loadGraphSnapshot(input.projectId, input.branchAId),
        loadGraphSnapshot(input.projectId, input.branchBId),
      ]);
      return diffGraphs(a, b);
    }),

  /** Why this artifact exists: what it was created to serve. */
  provenance: protectedProcedure.input(scope.extend({ refKey })).query(async ({ ctx, input }) => {
    await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
    const graph = await loadGraphSnapshot(input.projectId, input.branchId);
    return provenanceOf(graph, input.refKey);
  }),

  /** Rebuilds the derived half of the graph. Authored edges are untouched. */
  sync: protectedProcedure.input(scope).mutation(async ({ ctx, input }) => {
    const { project } = await requireProjectCapability(ctx.user.id, input.projectId, "graph.edit");
    return syncProductGraph({
      projectId: input.projectId,
      branchId: input.branchId,
      workspaceId: project.workspaceId,
      actorId: ctx.user.id,
    });
  }),

  /** Runs impact analysis and records the result on the affected artifacts. */
  markImpacted: protectedProcedure
    .input(scope.extend({ refKey, maxDepth: z.number().int().min(1).max(10).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "graph.edit",
      );
      return markImpacted({
        projectId: input.projectId,
        branchId: input.branchId,
        workspaceId: project.workspaceId,
        actorId: ctx.user.id,
        refKey: input.refKey,
        maxDepth: input.maxDepth,
      });
    }),

  /** "I looked, and this change does not apply here." */
  markReviewed: protectedProcedure
    .input(scope.extend({ nodeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "graph.edit",
      );
      const node = await prisma.productNode.findUnique({ where: { id: input.nodeId } });
      // Scoping to the branch stops a node id from another project being
      // cleared by anyone who happens to hold graph.edit on this one.
      if (!node || node.projectId !== input.projectId || node.branchId !== input.branchId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Graph node not found" });
      }
      await markNodeReviewed({
        nodeId: input.nodeId,
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
      });
      return { ok: true };
    }),

  /**
   * Draws a link the deriver is not allowed to guess at.
   *
   * These are the edges that carry engineering judgement — which part satisfies
   * which requirement, which code implements it — so the rationale is required,
   * not optional. An unexplained link is the kind of thing that survives in a
   * project long after anyone remembers why.
   */
  linkNodes: protectedProcedure
    .input(
      scope.extend({
        from: refKey,
        to: refKey,
        kind: edgeKind,
        rationale: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "graph.edit",
      );
      if (input.from === input.to) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A node cannot depend on itself" });
      }
      const [from, to] = await Promise.all([
        nodeByRefKey(input.projectId, input.branchId, input.from),
        nodeByRefKey(input.projectId, input.branchId, input.to),
      ]);

      const edge = await prisma.productEdge.upsert({
        where: { fromId_toId_kind: { fromId: from.id, toId: to.id, kind: input.kind } },
        create: {
          projectId: input.projectId,
          branchId: input.branchId,
          fromId: from.id,
          toId: to.id,
          kind: input.kind,
          origin: "USER",
          confidence: 1,
          evidence: input.rationale,
          createdById: ctx.user.id,
        },
        // Promoting a derived edge to USER is intentional: a person confirming
        // a guess should make it stop being a guess, and stop it being deleted
        // by the next resync.
        update: { origin: "USER", confidence: 1, evidence: input.rationale },
      });

      await recordAudit({
        type: "ProductEdgeCreated",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { from: input.from, to: input.to, kind: input.kind, rationale: input.rationale },
      });
      return edge;
    }),

  unlinkNodes: protectedProcedure
    .input(scope.extend({ edgeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "graph.edit",
      );
      const edge = await prisma.productEdge.findUnique({ where: { id: input.edgeId } });
      if (!edge || edge.projectId !== input.projectId || edge.branchId !== input.branchId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Graph edge not found" });
      }
      await prisma.productEdge.delete({ where: { id: input.edgeId } });
      await recordAudit({
        type: "ProductEdgeDeleted",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { edgeId: input.edgeId, kind: edge.kind },
      });
      return { ok: true };
    }),

  /**
   * Graph writes the copilot has proposed but a human has not yet acted on.
   *
   * "Copilots draft and check, but ... stay behind explicit human approval"
   * is the platform's own claim; this is what makes it true for the graph.
   * `link_nodes`, `add_tasks` and `add_risks` (server/ai/graph-tools.ts) write
   * a GraphProposal instead of a ProductNode/ProductEdge directly, and only
   * `approveProposal` below ever materialises one.
   */
  listProposals: protectedProcedure
    .input(scope.extend({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      const proposals = await prisma.graphProposal.findMany({
        where: {
          projectId: input.projectId,
          branchId: input.branchId,
          status: input.status,
        },
        orderBy: { proposedAt: "desc" },
      });
      const userIds = [...new Set(proposals.map((p) => p.proposedById))];
      const users = userIds.length
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [];
      const nameById = new Map(users.map((u) => [u.id, u.name]));
      return proposals.map((p) => ({ ...p, proposedByName: nameById.get(p.proposedById) ?? null }));
    }),

  approveProposal: protectedProcedure
    .input(scope.extend({ proposalId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "graph.edit",
      );
      const proposal = await prisma.graphProposal.findUnique({
        where: { id: input.proposalId },
      });
      if (
        !proposal ||
        proposal.projectId !== input.projectId ||
        proposal.branchId !== input.branchId
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });
      }
      // Claim it atomically: two reviewers clicking Approve at once must not
      // both materialise the same task. Only the request that flips PENDING
      // wins; the status is corrected below if the approval turns into a
      // rejection.
      const claimed = await prisma.graphProposal.updateMany({
        where: { id: proposal.id, status: "PENDING" },
        data: { status: "APPROVED", decidedById: ctx.user.id, decidedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Proposal already decided" });
      }

      const decide = (
        patch: Partial<{
          status: "REJECTED";
          decisionNote: string;
          resultNodeId: string;
          resultEdgeId: string;
        }>,
      ) => prisma.graphProposal.update({ where: { id: proposal.id }, data: patch });

      if (proposal.kind === "LINK") {
        const { from, to, kind, rationale } = proposal.payload as {
          from: string;
          to: string;
          kind: (typeof PRODUCT_EDGE_KINDS)[number];
          rationale: string;
        };
        const [fromNode, toNode] = await Promise.all([
          prisma.productNode.findUnique({
            where: {
              projectId_branchId_refKey: {
                projectId: input.projectId,
                branchId: input.branchId,
                refKey: from,
              },
            },
          }),
          prisma.productNode.findUnique({
            where: {
              projectId_branchId_refKey: {
                projectId: input.projectId,
                branchId: input.branchId,
                refKey: to,
              },
            },
          }),
        ]);
        // The graph moved on since this was proposed — the honest outcome is
        // an automatic rejection with a reason, never a half-real edge.
        if (!fromNode || !toNode) {
          await decide({
            status: "REJECTED",
            decisionNote: "An endpoint no longer exists in the graph.",
          });
          await recordAudit({
            type: "ProductGraphProposalRejected",
            workspaceId: project.workspaceId,
            projectId: input.projectId,
            branchId: input.branchId,
            actorId: ctx.user.id,
            payload: { proposalId: proposal.id, reason: "endpoint-missing" },
          });
          return {
            decided: "REJECTED" as const,
            reason: "An endpoint no longer exists in the graph.",
          };
        }

        const where = { fromId_toId_kind: { fromId: fromNode.id, toId: toNode.id, kind } };
        const existing = await prisma.productEdge.findUnique({ where, select: { origin: true } });
        const edge = await prisma.productEdge.upsert({
          where,
          create: {
            projectId: input.projectId,
            branchId: input.branchId,
            fromId: fromNode.id,
            toId: toNode.id,
            kind,
            origin: "AGENT",
            confidence: 1,
            evidence: rationale,
            createdById: proposal.proposedById,
          },
          // A person already drew this link: their judgement stands. A derived
          // guess, though, is promoted so the next resync stops deleting it.
          update:
            existing?.origin === "USER"
              ? {}
              : { origin: "AGENT", confidence: 1, evidence: rationale },
        });
        await decide({ resultEdgeId: edge.id });
        await recordAudit({
          type: "ProductGraphProposalApproved",
          workspaceId: project.workspaceId,
          projectId: input.projectId,
          branchId: input.branchId,
          actorId: ctx.user.id,
          payload: { proposalId: proposal.id, kind: "LINK", from, to, edgeKind: kind },
        });
        return { decided: "APPROVED" as const, edgeId: edge.id };
      }

      // TASK / RISK: the node itself is what was proposed — nothing to
      // re-validate against, since there is no prior state it could conflict
      // with. Approving just means "yes, add this to the graph."
      const nodeKind = proposal.kind; // "TASK" | "RISK"
      const payload = proposal.payload as {
        title: string;
        detail?: string | null;
        status?: "todo" | "doing" | "done";
        severity?: "low" | "medium" | "high";
        dependsOn?: string[];
      };
      const refKey = `${nodeKind.toLowerCase()}:${crypto.randomUUID()}`;
      const node = await prisma.productNode.create({
        data: {
          projectId: input.projectId,
          branchId: input.branchId,
          kind: nodeKind,
          refKey,
          label: payload.title,
          data:
            nodeKind === "TASK"
              ? { status: payload.status ?? "todo", detail: payload.detail ?? null }
              : { severity: payload.severity ?? "medium", detail: payload.detail ?? null },
          origin: "AGENT",
          originDetail: nodeKind === "TASK" ? "agent:add_tasks" : "agent:add_risks",
          createdById: proposal.proposedById,
        },
      });

      // Wire DEPENDS_ON in both directions against tasks already in the graph,
      // matched by title: this task's own prerequisites, and earlier-approved
      // tasks that were waiting on this one. Approval order therefore never
      // loses a dependency.
      let dependencies = 0;
      if (nodeKind === "TASK") {
        const [existingTasks, approvedTaskProposals] = await Promise.all([
          prisma.productNode.findMany({
            where: { projectId: input.projectId, branchId: input.branchId, kind: "TASK" },
            select: { id: true, label: true },
          }),
          prisma.graphProposal.findMany({
            where: {
              projectId: input.projectId,
              branchId: input.branchId,
              kind: "TASK",
              status: "APPROVED",
              resultNodeId: { not: null },
            },
            select: { payload: true, resultNodeId: true },
          }),
        ]);
        const norm = (title: string) => title.trim().toLowerCase();
        const byTitle = new Map(existingTasks.map((t) => [norm(t.label), t.id]));
        const pairs: { fromId: string; toId: string; waiting: string; on: string }[] = [];
        for (const prerequisite of payload.dependsOn ?? []) {
          const fromId = byTitle.get(norm(prerequisite));
          if (fromId && fromId !== node.id) {
            pairs.push({ fromId, toId: node.id, waiting: payload.title, on: prerequisite });
          }
        }
        for (const p of approvedTaskProposals) {
          const earlier = p.payload as { title?: string; dependsOn?: string[] };
          if (p.resultNodeId && earlier.dependsOn?.some((d) => norm(d) === norm(payload.title))) {
            pairs.push({
              fromId: node.id,
              toId: p.resultNodeId,
              waiting: earlier.title ?? "a task",
              on: payload.title,
            });
          }
        }
        for (const { fromId, toId, waiting, on } of pairs) {
          await prisma.productEdge.upsert({
            where: { fromId_toId_kind: { fromId, toId, kind: "DEPENDS_ON" } },
            create: {
              projectId: input.projectId,
              branchId: input.branchId,
              fromId,
              toId,
              kind: "DEPENDS_ON",
              origin: "AGENT",
              confidence: 1,
              evidence: `${waiting} waits on ${on}`,
              createdById: proposal.proposedById,
            },
            update: {},
          });
          dependencies++;
        }
      }

      await decide({ resultNodeId: node.id });
      await recordAudit({
        type: "ProductGraphProposalApproved",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { proposalId: proposal.id, kind: nodeKind, title: payload.title, dependencies },
      });
      return { decided: "APPROVED" as const, nodeId: node.id };
    }),

  rejectProposal: protectedProcedure
    .input(scope.extend({ proposalId: z.string(), rationale: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "graph.edit",
      );
      const proposal = await prisma.graphProposal.findUnique({ where: { id: input.proposalId } });
      if (
        !proposal ||
        proposal.projectId !== input.projectId ||
        proposal.branchId !== input.branchId
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proposal not found" });
      }
      const claimed = await prisma.graphProposal.updateMany({
        where: { id: proposal.id, status: "PENDING" },
        data: {
          status: "REJECTED",
          decidedById: ctx.user.id,
          decidedAt: new Date(),
          decisionNote: input.rationale,
        },
      });
      if (claimed.count === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Proposal already decided" });
      }
      await recordAudit({
        type: "ProductGraphProposalRejected",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { proposalId: proposal.id, rationale: input.rationale },
      });
      return { ok: true };
    }),

  /**
   * Tasks and risks, which are the one place the graph is the record rather
   * than an index — nothing else in the schema stores them.
   */
  upsertTask: protectedProcedure
    .input(
      scope.extend({
        refKey: refKey.optional(),
        kind: z.enum(["TASK", "RISK", "DECISION"]).default("TASK"),
        title: z.string().trim().min(1).max(200),
        status: z.enum(["todo", "doing", "done"]).default("todo"),
        detail: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "graph.edit",
      );
      const key = input.refKey ?? `${input.kind.toLowerCase()}:${crypto.randomUUID()}`;
      if (input.refKey) {
        const existing = await prisma.productNode.findUnique({
          where: {
            projectId_branchId_refKey: {
              projectId: input.projectId,
              branchId: input.branchId,
              refKey: key,
            },
          },
          select: { kind: true },
        });
        if (existing && !["TASK", "RISK", "DECISION"].includes(existing.kind)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only tasks, risks and decisions can be edited here.",
          });
        }
      }

      const node = await prisma.productNode.upsert({
        where: {
          projectId_branchId_refKey: {
            projectId: input.projectId,
            branchId: input.branchId,
            refKey: key,
          },
        },
        create: {
          projectId: input.projectId,
          branchId: input.branchId,
          kind: input.kind,
          refKey: key,
          label: input.title,
          data: { status: input.status, detail: input.detail ?? null },
          origin: "USER",
          originDetail: "user:upsertTask",
          createdById: ctx.user.id,
        },
        update: {
          label: input.title,
          data: { status: input.status, detail: input.detail ?? null },
        },
      });

      await recordAudit({
        type: "ProductNodeCreated",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { refKey: key, kind: input.kind, title: input.title },
      });
      return node;
    }),

  deleteTask: protectedProcedure
    .input(scope.extend({ nodeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectCapability(
        ctx.user.id,
        input.projectId,
        "graph.edit",
      );
      const node = await prisma.productNode.findUnique({ where: { id: input.nodeId } });
      if (!node || node.projectId !== input.projectId || node.branchId !== input.branchId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Graph node not found" });
      }
      // Derived nodes are projections of something else; deleting one here
      // would only have it reappear at the next sync.
      if (node.origin === "DERIVED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Derived nodes follow the artifact they index — edit the artifact instead.",
        });
      }
      await prisma.productNode.delete({ where: { id: input.nodeId } });
      await recordAudit({
        type: "ProductNodeDeleted",
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: { refKey: node.refKey, kind: node.kind },
      });
      return { ok: true };
    }),
});

/** Re-exported so the UI can label which links a person has to draw. */
export { AUTHORED_ONLY_EDGE_KINDS };
