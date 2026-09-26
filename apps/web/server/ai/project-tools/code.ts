/**
 * Copilot tools: firmware and software files in the project repository.
 */

import { z } from "zod";
import { prisma } from "@foundry/db";
import { writeCodeWithCollaboration, deleteCodeWithCollaboration } from "../../collab-write";
import { recordAudit } from "../../audit";
import { type ToolContext, type ToolKit, guard, touchStage } from "./shared";

/** Firmware and software files in the project repository. */
export function buildCodeTools(ctx: ToolContext, _kit: ToolKit) {
  const { projectId, branchId } = ctx;

  return {
    delete_code_file: {
      description: "Delete a file from the project's code workspace (Engineer > Code).",
      inputSchema: z.object({
        path: z.string().min(1).max(300).describe("Repo-relative path, e.g. src/main.cpp"),
        repoRole: z.string().max(80).optional(),
      }),
      execute: async ({ path, repoRole }: { path: string; repoRole?: string }) =>
        guard(ctx, "software.edit", async (workspaceId) => {
          if (path.includes("..") || path.startsWith("/")) {
            return { error: "Invalid path" };
          }
          const repo = await prisma.repoLink.findFirst({
            where: { projectId, branchId, ...(repoRole ? { role: repoRole } : {}) },
            orderBy: { createdAt: "asc" },
          });
          if (!repo) return { error: "No linked repository" };
          const existing = await prisma.codeFile.findUnique({
            where: { repoId_path: { repoId: repo.id, path } },
          });
          if (!existing) return { ok: true, deleted: 0 };
          await deleteCodeWithCollaboration({
            fileId: existing.id,
            projectId,
            branchId,
            userId: ctx.userId,
            runId: ctx.runId,
          });
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return { ok: true, deleted: 1, path, staleStages: staled };
        }),
    },

    write_code_file: {
      description:
        "Create or overwrite a file in the project's code workspace (Engineer > Repository). Files belong to a linked repository; if none is linked yet, one is created automatically with role 'firmware'. Use for firmware, configs, or app scaffolding.",
      inputSchema: z.object({
        path: z.string().min(1).max(300).describe("Repo-relative path, e.g. src/main.cpp"),
        content: z.string().max(200_000),
        repoRole: z
          .string()
          .max(80)
          .optional()
          .describe(
            "Which linked repo to write into (matches the repo's role); defaults to the first repo",
          ),
      }),
      execute: async ({
        path,
        content,
        repoRole,
      }: {
        path: string;
        content: string;
        repoRole?: string;
      }) =>
        guard(ctx, "software.edit", async (workspaceId) => {
          if (path.includes("..") || path.startsWith("/")) {
            return { error: "Invalid path" };
          }
          let repo = await prisma.repoLink.findFirst({
            where: { projectId, branchId, ...(repoRole ? { role: repoRole } : {}) },
            orderBy: { createdAt: "asc" },
          });
          repo ??= await prisma.repoLink.create({
            data: {
              projectId,
              branchId,
              role: repoRole ?? "firmware",
              url: "https://github.com/link-me/placeholder",
              notes: "Created by copilot — replace with the real repository URL",
              createdById: ctx.userId,
            },
          });
          await writeCodeWithCollaboration({
            projectId,
            branchId,
            userId: ctx.userId,
            runId: ctx.runId,
            repoId: repo.id,
            path,
            content,
          });
          await recordAudit({
            type: "CollaborationDocumentUpdated",
            workspaceId,
            projectId,
            branchId,
            actorId: ctx.userId,
            actorType: "AGENT",
            payload: { repoId: repo.id, path, source: "write_code_file" },
          });
          const staled = await touchStage(ctx, workspaceId, "ENGINEER");
          return { ok: true, repo: repo.role, path, bytes: content.length, staleStages: staled };
        }),
    },
  };
}
