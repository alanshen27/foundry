import { z } from "zod";

/**
 * Launch/marketing media contracts (renders and short product video).
 *
 * Marketing approval is intentionally separate from `VerificationState`:
 * a hero render is never evidence that a product works (PRD 4, principle 3),
 * so `MediaApproval` gates storefront use without touching engineering state.
 */

export const PRODUCT_MEDIA_KINDS = ["STILL", "VIDEO"] as const;
export const productMediaKindSchema = z.enum(PRODUCT_MEDIA_KINDS);
export type ProductMediaKind = z.infer<typeof productMediaKindSchema>;

export const PRODUCT_MEDIA_ROLES = [
  "HERO",
  "GALLERY",
  "DETAIL",
  "LIFESTYLE",
  "SOCIAL",
  "EXPLODED",
  "OTHER",
] as const;
export const productMediaRoleSchema = z.enum(PRODUCT_MEDIA_ROLES);
export type ProductMediaRole = z.infer<typeof productMediaRoleSchema>;

export const PRODUCT_MEDIA_SOURCES = [
  "AI_IMAGE",
  "AI_VIDEO",
  "CAD_CAPTURE",
  "PCB_CAPTURE",
  "UPLOAD",
] as const;
export const productMediaSourceSchema = z.enum(PRODUCT_MEDIA_SOURCES);
export type ProductMediaSource = z.infer<typeof productMediaSourceSchema>;

export const MEDIA_APPROVALS = ["DRAFT", "APPROVED_FOR_MARKETING", "REJECTED"] as const;
export const mediaApprovalSchema = z.enum(MEDIA_APPROVALS);
export type MediaApproval = z.infer<typeof mediaApprovalSchema>;

export const SITE_MEDIA_SLOTS = ["HERO", "GALLERY", "VIDEO_PRIMARY", "SOCIAL"] as const;
export const siteMediaSlotSchema = z.enum(SITE_MEDIA_SLOTS);
export type SiteMediaSlot = z.infer<typeof siteMediaSlotSchema>;

/**
 * Per-slot attachment limits. A storefront has one hero and one primary video;
 * galleries stay small enough that a generated page can render them all.
 */
export const SITE_MEDIA_SLOT_LIMITS: Record<SiteMediaSlot, number> = {
  HERO: 1,
  VIDEO_PRIMARY: 1,
  GALLERY: 12,
  SOCIAL: 3,
};

/** Kind a slot accepts. Null = any kind. */
export const SITE_MEDIA_SLOT_KIND: Record<SiteMediaSlot, ProductMediaKind | null> = {
  HERO: "STILL",
  GALLERY: "STILL",
  SOCIAL: "STILL",
  VIDEO_PRIMARY: "VIDEO",
};

export const generateStillsInputSchema = z.object({
  projectId: z.string().min(1),
  releaseId: z.string().min(1).nullable().optional(),
  prompt: z.string().trim().min(10).max(2000),
  roles: z.array(productMediaRoleSchema).min(1).max(6),
  aspectRatio: z.enum(["1:1", "4:3", "16:9", "9:16"]).default("16:9"),
});
export type GenerateStillsInput = z.infer<typeof generateStillsInputSchema>;

export const generateVideoInputSchema = z.object({
  projectId: z.string().min(1),
  releaseId: z.string().min(1).nullable().optional(),
  prompt: z.string().trim().min(10).max(2000),
  /** Still used as the first frame. Keeps video anchored to approved renders. */
  seedMediaId: z.string().min(1).nullable().optional(),
  durationSec: z.number().int().min(2).max(30).default(6),
});
export type GenerateVideoInput = z.infer<typeof generateVideoInputSchema>;

export const attachSiteMediaInputSchema = z.object({
  siteId: z.string().min(1),
  mediaId: z.string().min(1),
  slot: siteMediaSlotSchema,
  altText: z.string().trim().max(200).optional(),
});
export type AttachSiteMediaInput = z.infer<typeof attachSiteMediaInputSchema>;

/**
 * Object storage key for a media asset, grouped by the batch that produced it.
 * Keys stay under `projects/{id}/…` so the existing authenticated file route
 * can serve them without new access rules.
 */
export function productMediaKey(input: {
  projectId: string;
  batchId: string;
  filename: string;
}): string {
  return `projects/${input.projectId}/media/${input.batchId}/${input.filename}`;
}

/** File extension for a stored mime type; defaults keep keys readable. */
export function mediaExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    default:
      return "bin";
  }
}

export type SiteMediaAttachmentLike = {
  slot: SiteMediaSlot;
  media: { kind: ProductMediaKind };
};

export type AttachmentRejection =
  | { ok: false; reason: "wrong_kind"; message: string }
  | { ok: false; reason: "slot_full"; message: string };

/**
 * Slot rules enforced server-side: a video cannot be a hero still, and slots
 * have hard caps so a generated page never receives an unbounded gallery.
 */
export function canAttachToSlot(input: {
  slot: SiteMediaSlot;
  kind: ProductMediaKind;
  existing: readonly SiteMediaAttachmentLike[];
}): { ok: true } | AttachmentRejection {
  const expectedKind = SITE_MEDIA_SLOT_KIND[input.slot];
  if (expectedKind && expectedKind !== input.kind) {
    return {
      ok: false,
      reason: "wrong_kind",
      message: `Slot ${input.slot} accepts ${expectedKind} media, not ${input.kind}`,
    };
  }
  const used = input.existing.filter((item) => item.slot === input.slot).length;
  const limit = SITE_MEDIA_SLOT_LIMITS[input.slot];
  if (used >= limit) {
    return {
      ok: false,
      reason: "slot_full",
      message: `Slot ${input.slot} already holds ${limit} item${limit === 1 ? "" : "s"}`,
    };
  }
  return { ok: true };
}
