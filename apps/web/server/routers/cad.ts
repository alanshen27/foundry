import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import {
  cadAssetFormatFromName,
  importAssetPath,
  isPythonCadComponent,
  normalizeCadDoc,
  type CadAssetFormat,
} from "@foundry/cad";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireProjectCapability } from "../access";
import { evaluateCadComponent } from "../python-cad";
import { getObjectStorage } from "../storage";

function formatMime(format: CadAssetFormat): string {
  if (format === "stl") return "model/stl";
  if (format === "step" || format === "stp" || format === "ste") return "model/step";
  if (format === "obj") return "model/obj";
  if (format === "gltf") return "model/gltf+json";
  if (format === "glb") return "model/gltf-binary";
  if (format === "ply") return "model/ply";
  if (format === "fbx") return "model/fbx";
  if (format === "kcl" || format === "py") return "text/plain";
  if (format === "svg") return "image/svg+xml";
  if (format === "kicad_sch" || format === "kicad_pcb" || format === "kicad_pro") {
    return "application/x-kicad";
  }
  return "application/octet-stream";
}

export const cadRouter = router({
  /** Exact overall dimensions from the local OCCT solid geometry. */
  measure: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        componentId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectCapability(ctx.user.id, input.projectId, "project.read");
      const row = await prisma.designDoc.findUnique({
        where: {
          projectId_branchId_kind: {
            projectId: input.projectId,
            branchId: input.branchId,
            kind: "MODEL3D",
          },
        },
      });
      if (!row?.data) throw new TRPCError({ code: "NOT_FOUND", message: "CAD document not found" });

      const doc = normalizeCadDoc(row.data);
      const component = doc.components.find((candidate) => candidate.id === input.componentId);
      if (!component || component.kind === "instructions") {
        throw new TRPCError({ code: "NOT_FOUND", message: "CAD component not found" });
      }
      if (!isPythonCadComponent(component)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Convert this preserved KCL part to Python/build123d for local measurement.",
        });
      }
      let result;
      try {
        result = await evaluateCadComponent(doc, component.id, input.projectId);
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The selected Python model could not be measured. Check its source and imports.",
        });
      }
      return {
        componentId: component.id,
        componentName: component.name,
        unit: "mm" as const,
        ...result.bbox,
      };
    }),

  /**
   * Upload a design resource. Engine-readable formats become geometry; native
   * source/electronics formats remain preserved UNVERIFIED references.
   * Stores under projects/{id}/cad/imports/… and creates an UNVERIFIED artifact.
   */
  importMesh: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        branchId: z.string(),
        filename: z.string().min(1).max(160),
        /** Base64 body; ~25 MB decoded max for design imports. */
        contentBase64: z.string().max(35_000_000),
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
          message: "This file extension is not supported by the design importer.",
        });
      }

      const body = Buffer.from(input.contentBase64, "base64");
      if (body.byteLength === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Empty file" });
      }
      if (body.byteLength > 25_000_000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "File exceeds the 25 MB import limit",
        });
      }

      const path = importAssetPath(input.filename, format);
      const safeName = path.split("/").pop() ?? input.filename;
      const key = `projects/${input.projectId}/cad/imports/${randomUUID()}-${safeName}`;
      const mimeType = formatMime(format);
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
