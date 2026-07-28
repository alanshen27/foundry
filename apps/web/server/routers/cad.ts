import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import {
  cadAssetFormatFromName,
  importAssetPath,
  type CadAssetFormat,
} from "@foundry/cad";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireProjectCapability } from "../access";
import { getZooEngineToken } from "../zoo-token";
import { getObjectStorage } from "../storage";

const FORMAT_MIME: Record<CadAssetFormat, string> = {
  stl: "model/stl",
  step: "model/step",
  stp: "model/step",
  obj: "model/obj",
  gltf: "model/gltf+json",
  glb: "model/gltf-binary",
  ply: "model/ply",
};

export const cadRouter = router({
  /** Short-lived use: Zoo WebRTC client token for the mechanical viewport. */
  engineSession: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      return {
        token: getZooEngineToken(),
        // Match Zoo viewer: https base; @kittycad/lib rewrites to wss for modeling WS.
        baseUrl: "https://api.zoo.dev",
      };
    }),

  /**
   * Upload a mesh/B-Rep file for KCL foreign import (STL/STEP/OBJ/…).
   * Stores under projects/{id}/cad/imports/… and creates an UNVERIFIED artifact.
   */
  importMesh: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        filename: z.string().min(1).max(160),
        /** Base64 body; ~10 MB decoded max for CAD imports. */
        contentBase64: z.string().max(14_000_000),
        lengthUnit: z.enum(["mm", "cm", "m", "in", "ft", "yd"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await prisma.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      await requireProjectCapability(ctx.user.id, input.projectId, "mechanical.edit");

      const format = cadAssetFormatFromName(input.filename);
      if (!format) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unsupported format. Use STL, STEP, OBJ, GLTF/GLB, or PLY.",
        });
      }

      const body = Buffer.from(input.contentBase64, "base64");
      if (body.byteLength === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Empty file" });
      }
      if (body.byteLength > 10_000_000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "File exceeds 10 MB limit" });
      }

      const path = importAssetPath(input.filename, format);
      const safeName = path.split("/").pop() ?? input.filename;
      const key = `projects/${input.projectId}/cad/imports/${randomUUID()}-${safeName}`;
      const mimeType = FORMAT_MIME[format];
      const stored = await getObjectStorage().put(key, body, mimeType);

      const artifact = await prisma.artifact.create({
        data: {
          projectId: project.id,
          branchId: input.branchId,
          kind: "cad_import",
          name: safeName,
          storageKey: stored.key,
          sha256: stored.sha256,
          mimeType,
          sizeBytes: stored.sizeBytes,
          verificationState: "UNVERIFIED",
          createdById: ctx.user.id,
        },
      });

      await recordAudit({
        type: "ArtifactUploadRequested",
        workspaceId: project.workspaceId,
        projectId: project.id,
        branchId: input.branchId,
        actorId: ctx.user.id,
        payload: {
          artifactId: artifact.id,
          sha256: stored.sha256,
          backend: stored.backend,
          cadPath: path,
          format,
        },
      });

      return {
        asset: {
          id: randomUUID(),
          name: safeName.replace(/\.[^.]+$/, ""),
          path,
          format,
          storageKey: stored.key,
          sizeBytes: stored.sizeBytes,
          lengthUnit: input.lengthUnit ?? "mm",
        },
        artifactId: artifact.id,
        fileUrl: `/api/files/${stored.key}`,
      };
    }),
});
