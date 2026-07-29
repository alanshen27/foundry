import "server-only";
import { prisma } from "@foundry/db";
import type { SiteMediaAsset } from "@foundry/sites";
import { getObjectStorage } from "./storage";

/** Signed URLs must outlive a builder generation run plus a preview session. */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Loads the media attached to a site as builder-ready assets.
 *
 * Only marketing-approved, non-simulated assets are handed to the builder:
 * a generated storefront must never embed a placeholder render (AGENTS.md
 * rule 3) or an asset nobody signed off on (PRD 24.4).
 */
export async function loadSiteMediaForPrompt(siteId: string): Promise<SiteMediaAsset[]> {
  const attachments = await prisma.siteMediaAttachment.findMany({
    where: {
      siteId,
      media: { approval: "APPROVED_FOR_MARKETING", simulated: false },
    },
    include: { media: true },
    orderBy: [{ slot: "asc" }, { sortOrder: "asc" }],
  });
  if (attachments.length === 0) return [];

  const storage = getObjectStorage();
  return Promise.all(
    attachments.map(async (attachment) => ({
      slot: attachment.slot,
      kind: attachment.media.kind,
      url: await storage.getSignedUrl(attachment.media.storageKey, SIGNED_URL_TTL_SECONDS),
      altText: attachment.altText,
      posterUrl: attachment.media.posterStorageKey
        ? await storage.getSignedUrl(attachment.media.posterStorageKey, SIGNED_URL_TTL_SECONDS)
        : null,
    })),
  );
}
