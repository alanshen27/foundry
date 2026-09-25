/**
 * The copilot's access to the product graph.
 *
 * Two of the five tools are read-only: the graph's value to the model is that
 * it can look up what a change touches instead of asserting consequences from
 * memory, which is precisely the thing a language model is worst at and a
 * traversal is perfect at. `link_nodes` exists because the model genuinely is
 * the best available source for the edges the deriver refuses to guess —
 * which part satisfies which requirement, which file implements it. Those
 * carry a required rationale for the same reason a human-drawn link does.
 *
 * `link_nodes`, `add_tasks` and `add_risks` do not write the graph directly —
 * each writes a GraphProposal (server/routers/graph.ts) that sits PENDING
 * until a person approves or rejects it in the proposal inbox. This is what
 * makes the platform's own claim — "copilots draft and check, but ... stay
 * behind explicit human approval" — true for the graph, not just for
 * publishing and checkout.
 */

import { z } from "zod";
import { prisma } from "@foundry/db";
import type { Capability } from "@foundry/domain";
import { impactFrom, provenanceOf, renderPath } from "@/lib/graph/impact";
import { PRODUCT_EDGE_KINDS, type GraphSnapshot } from "@/lib/graph/types";
import { requireProjectCapability } from "../access";
import { recordAudit } from "../audit";
import { loadGraphSnapshot } from "../graph/sync";

export type GraphToolContext = {
  userId: string;
  projectId: string;
  branchId: string;
};

async function guard<T>(
  ctx: GraphToolContext,
  capability: Capability,
  fn: (workspaceId: string) => Promise<T>,
): Promise<T | { error: string }> {
  try {
    const { project } = await requireProjectCapability(ctx.userId, ctx.projectId, capability);
    return await fn(project.workspaceId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Operation failed" };
  }
}

/**
 * Resolves whatever the model typed to a node.
 *
 * The model refers to things the way it last saw them — "BT1", "the battery",
 * "parts/enclosure.kcl", or an exact refKey — and forcing it to produce
 * internal ids would just move the guessing into the prompt. Exact matches
 * win; an ambiguous fuzzy match returns the candidates and asks rather than
 * picking one, because silently analysing the wrong part is worse than asking.
 */
function resolveTarget(
  graph: GraphSnapshot,
  target: string,
): { refKey: string } | { ambiguous: string[] } | { missing: true } {
  const needle = target.trim().toLowerCase();
  if (!needle) return { missing: true };

  const exact = graph.nodes.find((n) => n.refKey.toLowerCase() === needle);
  if (exact) return { refKey: exact.refKey };

  const byLabel = graph.nodes.filter((n) => n.label.toLowerCase() === needle);
  if (byLabel.length === 1) return { refKey: byLabel[0]!.refKey };

  const partial = graph.nodes.filter(
    (n) => n.label.toLowerCase().includes(needle) || n.refKey.toLowerCase().includes(needle),
  );
  if (partial.length === 1) return { refKey: partial[0]!.refKey };
  if (partial.length > 1) return { ambiguous: partial.slice(0, 8).map((n) => n.refKey) };
  return { missing: true };
}

const NO_GRAPH = {
  error:
    "This project has no product graph yet. Change any artifact, or call graph.sync, to build it.",
} as const;

export function buildGraphTools(ctx: GraphToolContext) {
  const { projectId, branchId } = ctx;

  return {
    analyze_impact: {
      description:
        "Before proposing a component swap, a requirement change or a rewire, call this: it walks the product graph from the thing you are about to change and returns every downstream artifact that would need another look, each with the chain of links that explains why. Use the result instead of reasoning about consequences from memory — the graph knows about wiring, firmware pins and CAD containment that is not in the conversation. `target` can be a reference designator (BT1), an artifact path (parts/enclosure.kcl), a requirement title, or a refKey.",
      inputSchema: z.object({
        target: z.string().min(1).max(200).describe("What is changing."),
        maxDepth: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe("How many links to follow. Default 6."),
      }),
      execute: async ({ target, maxDepth }: { target: string; maxDepth?: number }) =>
        guard(ctx, "project.read", async () => {
          const graph = await loadGraphSnapshot(projectId, branchId);
          if (graph.nodes.length === 0) return NO_GRAPH;

          const resolved = resolveTarget(graph, target);
          if ("missing" in resolved) {
            return { error: `Nothing in the project matches "${target}".` };
          }
          if ("ambiguous" in resolved) {
            return {
              error: `"${target}" matches several things. Use one of these exactly.`,
              candidates: resolved.ambiguous,
            };
          }

          const impacted = impactFrom(graph, resolved.refKey, { maxDepth });
          const root = graph.nodes.find((n) => n.refKey === resolved.refKey);
          return {
            target: resolved.refKey,
            targetLabel: root?.label ?? resolved.refKey,
            affected: impacted.length,
            impacted: impacted.map((n) => ({
              refKey: n.refKey,
              label: n.label,
              kind: n.kind,
              reason: n.reason,
              path: renderPath(n),
              depth: n.depth,
              // "review" is a structural certainty; "possible" is a chain of
              // heuristics. Report the distinction rather than flattening it.
              severity: n.severity,
            })),
          };
        }),
    },

    explain_provenance: {
      description:
        "Why does this artifact exist? Walks the product graph backwards from an artifact and returns what it was created to serve — the requirements it satisfies, the parts it realises — along with how it got into the project (derived from other data, authored by a person, or created by you).",
      inputSchema: z.object({
        target: z.string().min(1).max(200).describe("The artifact to explain."),
      }),
      execute: async ({ target }: { target: string }) =>
        guard(ctx, "project.read", async () => {
          const graph = await loadGraphSnapshot(projectId, branchId);
          if (graph.nodes.length === 0) return NO_GRAPH;

          const resolved = resolveTarget(graph, target);
          if (!("refKey" in resolved)) {
            return { error: `Nothing in the project matches "${target}".` };
          }
          const { node, justifiedBy } = provenanceOf(graph, resolved.refKey);
          return {
            refKey: resolved.refKey,
            label: node?.label,
            origin: node?.origin,
            originDetail: node?.originDetail,
            justifiedBy: justifiedBy.map((n) => ({
              refKey: n.refKey,
              label: n.label,
              kind: n.kind,
              reason: n.reason,
            })),
          };
        }),
    },

    link_nodes: {
      description:
        "Propose a link the system cannot work out for itself: which component or file satisfies a requirement, which task implements it, which risk a decision mitigates. Use it whenever you choose a part to meet a stated requirement, so a later change to that part surfaces the requirement. Do NOT use it for wiring, footprints, CAD imports or check target paths — those are derived automatically and a manual duplicate adds nothing. This does not take effect immediately: it is queued for a person to approve or reject. The rationale is required and is shown to whoever reviews it.",
      inputSchema: z.object({
        from: z.string().min(1).max(200).describe("The thing depended on, e.g. a component."),
        to: z
          .string()
          .min(1)
          .max(200)
          .describe("The thing that depends on it, e.g. a requirement."),
        kind: z
          .enum(PRODUCT_EDGE_KINDS)
          .describe("SATISFIES, IMPLEMENTED_BY, DEPENDS_ON, DERIVED_FROM or MITIGATES."),
        rationale: z.string().min(1).max(500).describe("Why this link holds."),
      }),
      execute: async (input: {
        from: string;
        to: string;
        kind: (typeof PRODUCT_EDGE_KINDS)[number];
        rationale: string;
      }) =>
        guard(ctx, "graph.edit", async (workspaceId) => {
          const graph = await loadGraphSnapshot(projectId, branchId);
          if (graph.nodes.length === 0) return NO_GRAPH;

          const from = resolveTarget(graph, input.from);
          const to = resolveTarget(graph, input.to);
          if (!("refKey" in from)) return { error: `No match for "${input.from}".` };
          if (!("refKey" in to)) return { error: `No match for "${input.to}".` };
          if (from.refKey === to.refKey) return { error: "A node cannot depend on itself." };

          const proposal = await prisma.graphProposal.create({
            data: {
              projectId,
              branchId,
              kind: "LINK",
              payload: {
                from: from.refKey,
                to: to.refKey,
                // Labels as the reviewer should read them; refKeys embed row ids.
                fromLabel: graph.nodes.find((n) => n.refKey === from.refKey)?.label ?? from.refKey,
                toLabel: graph.nodes.find((n) => n.refKey === to.refKey)?.label ?? to.refKey,
                kind: input.kind,
                rationale: input.rationale,
              },
              proposedById: ctx.userId,
            },
          });

          await recordAudit({
            type: "ProductGraphProposalCreated",
            workspaceId,
            projectId,
            branchId,
            actorId: ctx.userId,
            actorType: "AGENT",
            payload: {
              proposalId: proposal.id,
              kind: "LINK",
              from: from.refKey,
              to: to.refKey,
              edgeKind: input.kind,
              rationale: input.rationale,
            },
          });
          return {
            proposed: true,
            proposalId: proposal.id,
            from: from.refKey,
            to: to.refKey,
            kind: input.kind,
            message: "Proposed — pending a teammate's review in the graph inbox.",
          };
        }),
    },

    add_tasks: {
      description:
        "Propose development tasks. Tasks live only in the product graph — nothing else in the project stores them — so this is how a plan becomes trackable work. Give each task a `dependsOn` naming any task that must finish first. Each task is queued as its own proposal for a person to approve or reject; a dependency only takes effect once both tasks it names are approved.",
      inputSchema: z.object({
        tasks: z
          .array(
            z.object({
              title: z.string().min(1).max(200),
              detail: z.string().max(2000).optional(),
              status: z.enum(["todo", "doing", "done"]).default("todo"),
              dependsOn: z
                .array(z.string().max(200))
                .optional()
                .describe("Titles of tasks that must finish before this one."),
            }),
          )
          .min(1)
          .max(25),
      }),
      execute: async (input: {
        tasks: {
          title: string;
          detail?: string;
          status: "todo" | "doing" | "done";
          dependsOn?: string[];
        }[];
      }) =>
        guard(ctx, "graph.edit", async (workspaceId) => {
          const proposalIds: string[] = [];
          for (const task of input.tasks) {
            const proposal = await prisma.graphProposal.create({
              data: {
                projectId,
                branchId,
                kind: "TASK",
                payload: {
                  title: task.title,
                  detail: task.detail ?? null,
                  status: task.status,
                  dependsOn: task.dependsOn ?? [],
                },
                proposedById: ctx.userId,
              },
            });
            proposalIds.push(proposal.id);
          }
          await recordAudit({
            type: "ProductGraphProposalCreated",
            workspaceId,
            projectId,
            branchId,
            actorId: ctx.userId,
            actorType: "AGENT",
            payload: { kind: "TASK", count: input.tasks.length, proposalIds },
          });
          return {
            proposed: input.tasks.length,
            proposalIds,
            message: "Proposed — pending a teammate's review in the graph inbox.",
          };
        }),
    },

    add_risks: {
      description:
        "Propose a risk to the build with what it threatens. Like tasks, risks live only in the product graph. Each risk is queued for a person to approve or reject before it appears anywhere.",
      inputSchema: z.object({
        risks: z
          .array(
            z.object({
              title: z.string().min(1).max(200),
              detail: z.string().max(2000).optional(),
              severity: z.enum(["low", "medium", "high"]).default("medium"),
            }),
          )
          .min(1)
          .max(15),
      }),
      execute: async (input: {
        risks: { title: string; detail?: string; severity: "low" | "medium" | "high" }[];
      }) =>
        guard(ctx, "graph.edit", async (workspaceId) => {
          const proposalIds: string[] = [];
          for (const risk of input.risks) {
            const proposal = await prisma.graphProposal.create({
              data: {
                projectId,
                branchId,
                kind: "RISK",
                payload: {
                  title: risk.title,
                  detail: risk.detail ?? null,
                  severity: risk.severity,
                },
                proposedById: ctx.userId,
              },
            });
            proposalIds.push(proposal.id);
          }
          await recordAudit({
            type: "ProductGraphProposalCreated",
            workspaceId,
            projectId,
            branchId,
            actorId: ctx.userId,
            actorType: "AGENT",
            payload: { kind: "RISK", count: input.risks.length, proposalIds },
          });
          return {
            proposed: input.risks.length,
            proposalIds,
            message: "Proposed — pending a teammate's review in the graph inbox.",
          };
        }),
    },
  };
}
