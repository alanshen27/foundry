/**
 * Copilot tools: concept images and the screenshot renders the copilot uses to see its work.
 */

import { z } from "zod";
import { prisma, type Prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import { createLogger } from "@foundry/observability";
import { normalizeCadDoc } from "@/lib/cad/engine";
import { recordAudit } from "../../audit";
import { getObjectStorage } from "../../storage";
import { getCad } from "../../cad";
import { mintRenderToken } from "../../render-token";
import { withKclProjectDir } from "../../kcl-project-dir";
import { screenshotRenderPage } from "../render";
import { type ToolContext, type ToolKit, guard } from "./shared";

/** Base64-encodes a stored image for a multimodal tool result. */
async function imagePart(key: string) {
  const object = await getObjectStorage().get(key);
  if (!object) return null;
  return {
    type: "file" as const,
    data: { type: "data" as const, data: Buffer.from(object.body).toString("base64") },
    mediaType: object.contentType || "image/png",
  };
}

/**
 * Calls the OpenAI Images API. Tries gpt-image-2 first, then falls back to
 * older image models for accounts without access. Returns raw PNG bytes.
 */
async function generateImage(prompt: string): Promise<Uint8Array> {
  const env = getServerEnv();
  const request = async (model: string, extra: Record<string, unknown>) => {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, prompt, size: "1024x1024", n: 1, ...extra }),
    });
    const json = (await res.json()) as {
      data?: { b64_json?: string }[];
      error?: { message?: string };
    };
    if (!res.ok || !json.data?.[0]?.b64_json) {
      throw new Error(json.error?.message ?? `Image API failed (${res.status})`);
    }
    return Buffer.from(json.data[0].b64_json, "base64");
  };
  const candidates: [string, Record<string, unknown>][] = [
    ["gpt-image-2", { quality: "medium" }],
    ["gpt-image-1", { quality: "medium" }],
    ["dall-e-3", { response_format: "b64_json" }],
  ];
  let lastError: unknown;
  for (const [model, extra] of candidates) {
    try {
      return await request(model, extra);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Image generation failed");
}

/** Concept images and the screenshot renders the copilot uses to see its work. */
export function buildRenderTools(ctx: ToolContext, kit: ToolKit) {
  const { projectId, branchId } = ctx;
  const { progress } = kit;

  return {
    generate_concept_image: {
      description:
        "Generate a product concept image (industrial-design rendering) from a text description and attach it to the project's Design references. Do this BEFORE 3D modelling and use the image as the visual reference for text_to_cad. Also useful for exploring aesthetics with the user.",
      inputSchema: z.object({
        prompt: z
          .string()
          .min(10)
          .max(2500)
          .describe(
            "Detailed visual description: product, form factor, materials, colorway, background. Ask for a clean studio render.",
          ),
      }),
      execute: async ({ prompt }: { prompt: string }) =>
        guard(ctx, "site.edit", async (workspaceId) => {
          let png: Uint8Array;
          try {
            png = await generateImage(prompt);
          } catch (err) {
            return { error: err instanceof Error ? err.message : "Image generation failed" };
          }
          const key = `projects/${projectId}/ai/concept-${Date.now()}.png`;
          await getObjectStorage().put(key, png, "image/png");

          // Attach to the DESIGN doc so the Design tab shows references.
          const existing = await prisma.designDoc.findUnique({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "DESIGN" } },
          });
          const data = (existing?.data as Record<string, unknown> | null) ?? {};
          const conceptImages = Array.isArray(data.conceptImages) ? data.conceptImages : [];
          const nextData = {
            ...data,
            conceptImages: [...conceptImages, { key, prompt, createdAt: new Date().toISOString() }],
          };
          await prisma.designDoc.upsert({
            where: { projectId_branchId_kind: { projectId, branchId, kind: "DESIGN" } },
            create: {
              projectId,
              branchId,
              kind: "DESIGN",
              data: nextData as Prisma.InputJsonValue,
              updatedById: ctx.userId,
            },
            update: { data: nextData as Prisma.InputJsonValue, updatedById: ctx.userId },
          });
          await recordAudit({
            type: "DesignDocUpdated",
            workspaceId,
            projectId,
            branchId,
            actorId: ctx.userId,
            actorType: "AGENT",
            payload: { kind: "DESIGN", conceptImage: key },
          });
          return { ok: true, key, imageUrl: `/api/files/${key}`, prompt };
        }),
      toModelOutput: async ({ output }: { output: unknown }) => {
        const out = output as { key?: string; error?: string };
        if (!out?.key) {
          return { type: "error-text" as const, value: out?.error ?? "Image generation failed" };
        }
        const image = await imagePart(out.key);
        return {
          type: "content" as const,
          value: [
            {
              type: "text" as const,
              text: "Concept image generated — use it as the design reference:",
            },
            ...(image ? [image] : []),
          ],
        };
      },
    },

    render_model_views: {
      description:
        "Screenshot the current 3D model / product assembly from multiple camera angles and look at the results. Prefers Zoo MCP multiview for the product assembly (real engine execute); falls back to the headless viewport which WAITS until the model has painted. Use after text_to_cad, add_part_to_assembly, or save_cad_script.",
      inputSchema: z.object({
        views: z
          .array(z.enum(["iso", "front", "top", "right"]))
          .min(1)
          .max(4)
          .default(["iso", "front", "top", "right"]),
      }),
      execute: async (
        { views }: { views: ("iso" | "front" | "top" | "right")[] },
        { toolCallId }: { toolCallId: string },
      ) =>
        guard(ctx, "project.read", async () => {
          const storage = getObjectStorage();
          progress(toolCallId, "snapshot");

          // Prefer Zoo MCP multiview — executes KCL on Zoo and returns a real collage.
          try {
            const cad = getCad();
            const modelRow = await prisma.designDoc.findUnique({
              where: { projectId_branchId_kind: { projectId, branchId, kind: "MODEL3D" } },
            });
            const doc = normalizeCadDoc(modelRow?.data ?? null);
            const assembly =
              doc.components.find(
                (c) => c.kind === "assembly" && c.path === "assembly/product.kcl",
              ) ?? doc.components.find((c) => c.kind === "assembly");
            const entry =
              assembly ?? doc.components.find((c) => c.kind === "part" && c.content.trim()) ?? null;

            if (entry) {
              const snap = await withKclProjectDir(doc, entry.path, (projectDir) =>
                cad.multiviewSnapshotKcl({ projectDir }),
              );
              if (snap.ok) {
                const key = `projects/${projectId}/ai/model-multiview-${Date.now()}.jpg`;
                await storage.put(key, new Uint8Array(snap.data.jpeg), "image/jpeg");
                return {
                  ok: true,
                  source: "zoo-mcp",
                  images: [
                    {
                      view: "multiview",
                      key,
                      imageUrl: `/api/files/${key}`,
                      layout: "front | right / top | iso",
                    },
                  ],
                };
              }
              createLogger("tool").warn("Zoo snapshot unavailable", { tool: "render_model_views" });
            }
          } catch {
            createLogger("tool").warn("Zoo snapshot unavailable; using viewport", {
              tool: "render_model_views",
            });
          }

          progress(toolCallId, "snapshot", "Zoo snapshot unavailable — rendering in the viewport");
          const token = mintRenderToken({ projectId, branchId, kind: "model3d" });
          try {
            // Serial views — parallel Zoo WebRTC cold-starts routinely time out
            // as "Connecting…". Cap the fallback at 2 views × 45s so one
            // inspect can't burn many minutes of Playwright on a small dyno;
            // the MCP path above returns all four angles in one collage.
            const fallbackViews = views.slice(0, 2);
            const images: { view: string; key: string; imageUrl: string }[] = [];
            for (const view of fallbackViews) {
              const url = `${ctx.origin}/render/model3d?token=${encodeURIComponent(token)}&view=${view}`;
              const png = await screenshotRenderPage(url, {
                width: 640,
                height: 480,
                readyTimeout: 45_000,
                requireReady: true,
              });
              const key = `projects/${projectId}/ai/model-${view}-${Date.now()}.png`;
              await storage.put(key, new Uint8Array(png), "image/png");
              images.push({ view, key, imageUrl: `/api/files/${key}` });
            }
            return { ok: true, source: "viewport", images };
          } catch {
            return {
              error: "Rendering failed. Try again or contact a workspace administrator.",
            };
          }
        }).finally(() => ctx.onCadProgressEnd?.(toolCallId)),
      toModelOutput: async ({ output }: { output: unknown }) => {
        const out = output as { images?: { view: string; key: string }[]; error?: string };
        if (!out?.images) {
          return { type: "error-text" as const, value: out?.error ?? "Rendering failed" };
        }
        const value: (
          { type: "text"; text: string } | NonNullable<Awaited<ReturnType<typeof imagePart>>>
        )[] = [];
        for (const image of out.images) {
          const part = await imagePart(image.key);
          value.push({ type: "text" as const, text: `${image.view} view:` });
          if (part) value.push(part);
        }
        return { type: "content" as const, value };
      },
    },

    render_circuit: {
      description:
        "Screenshot the current circuit schematic and look at it. Use after save_circuit or import_wokwi_diagram to check part placement, overlaps, and wiring — then fix and re-render.",
      inputSchema: z.object({}),
      execute: async () =>
        guard(ctx, "project.read", async () => {
          const token = mintRenderToken({ projectId, branchId, kind: "circuit" });
          try {
            const url = `${ctx.origin}/render/circuit?token=${encodeURIComponent(token)}`;
            const png = await screenshotRenderPage(url, {
              width: 1024,
              height: 720,
              readyTimeout: 60_000,
              requireReady: true,
            });
            const key = `projects/${projectId}/ai/circuit-${Date.now()}.png`;
            await getObjectStorage().put(key, new Uint8Array(png), "image/png");
            return { ok: true, key, imageUrl: `/api/files/${key}` };
          } catch {
            return {
              error: "Rendering failed. Try again or contact a workspace administrator.",
            };
          }
        }),
      toModelOutput: async ({ output }: { output: unknown }) => {
        const out = output as { key?: string; error?: string };
        if (!out?.key) {
          return { type: "error-text" as const, value: out?.error ?? "Rendering failed" };
        }
        const image = await imagePart(out.key);
        return {
          type: "content" as const,
          value: [{ type: "text" as const, text: "Current schematic:" }, ...(image ? [image] : [])],
        };
      },
    },

    render_pcb: {
      description:
        "Screenshot the current PCB board layout and look at it. Use after save_pcb to check outline size, footprint overlaps, edge clearance, and connector placement — then fix and re-render.",
      inputSchema: z.object({}),
      execute: async () =>
        guard(ctx, "project.read", async () => {
          const token = mintRenderToken({ projectId, branchId, kind: "pcb" });
          try {
            const url = `${ctx.origin}/render/pcb?token=${encodeURIComponent(token)}`;
            const png = await screenshotRenderPage(url, {
              width: 1024,
              height: 720,
              readyTimeout: 60_000,
              requireReady: true,
            });
            const key = `projects/${projectId}/ai/pcb-${Date.now()}.png`;
            await getObjectStorage().put(key, new Uint8Array(png), "image/png");
            return { ok: true, key, imageUrl: `/api/files/${key}` };
          } catch {
            return {
              error: "Rendering failed. Try again or contact a workspace administrator.",
            };
          }
        }),
      toModelOutput: async ({ output }: { output: unknown }) => {
        const out = output as { key?: string; error?: string };
        if (!out?.key) {
          return { type: "error-text" as const, value: out?.error ?? "Rendering failed" };
        }
        const image = await imagePart(out.key);
        return {
          type: "content" as const,
          value: [
            { type: "text" as const, text: "Current PCB layout:" },
            ...(image ? [image] : []),
          ],
        };
      },
    },
  };
}
