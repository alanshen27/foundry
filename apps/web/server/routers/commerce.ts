import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { canActivateListing } from "@foundry/commerce";
import { protectedProcedure, router } from "../trpc";
import { recordAudit } from "../audit";
import { requireWorkspaceCapability } from "../access";
import { getCommerce } from "../commerce";

const SALE_MODES = [
  "PHYSICAL",
  "PREORDER",
  "KIT",
  "PCB_ONLY",
  "MECHANICAL_FILES",
  "DESIGN_BUNDLE",
  "LICENSE",
  "TEMPLATE",
] as const;

/** Never selects storefrontToken — it must not reach the browser. */
const CHECKOUT_PUBLIC_FIELDS = {
  id: true,
  provider: true,
  shopDomain: true,
  sellerName: true,
  currency: true,
} as const;

/** Loads a site and asserts the caller holds `capability` in its workspace. */
async function siteWithAccess(
  userId: string,
  siteId: string,
  capability: "project.read" | "commerce.manage",
) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: { checkout: true },
  });
  if (!site) throw new TRPCError({ code: "NOT_FOUND", message: "Site not found" });
  await requireWorkspaceCapability(
    userId,
    site.workspaceId,
    capability,
    site.projectId ?? undefined,
  );
  return site;
}

function credentialsOf(site: { checkout: { shopDomain: string; storefrontToken: string } | null }) {
  return site.checkout
    ? { shopDomain: site.checkout.shopDomain, storefrontToken: site.checkout.storefrontToken }
    : null;
}

export const commerceRouter = router({
  capabilities: protectedProcedure
    .input(z.object({ siteId: z.string() }))
    .query(async ({ ctx, input }) => {
      const site = await siteWithAccess(ctx.user.id, input.siteId, "project.read");
      return {
        provider: site.checkout?.provider ?? "SHOPIFY",
        catalog: true,
        checkout: true,
        orders: false,
        ordersReason:
          "This site uses Shopify's Storefront API, which does not expose merchant orders. Order sync requires a Shopify Admin API connection and verified order webhooks.",
      } as const;
    }),

  getCheckoutConfig: protectedProcedure
    .input(z.object({ siteId: z.string() }))
    .query(async ({ ctx, input }) => {
      await siteWithAccess(ctx.user.id, input.siteId, "project.read");
      return prisma.checkoutConfiguration.findUnique({
        where: { siteId: input.siteId },
        select: CHECKOUT_PUBLIC_FIELDS,
      });
    }),

  configureCheckout: protectedProcedure
    .input(
      z.object({
        siteId: z.string(),
        shopDomain: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .regex(/^[a-zA-Z0-9.-]+$/, "Use a bare domain like my-store.myshopify.com"),
        storefrontToken: z.string().trim().min(1).max(255),
        sellerName: z.string().trim().min(1).max(160),
        currency: z.string().trim().length(3).toUpperCase().default("USD"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const site = await siteWithAccess(ctx.user.id, input.siteId, "commerce.manage");

      // A simulated site has no real product to sell.
      if (site.simulated) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This site is SIMULATED. Generate a real site before connecting a store.",
        });
      }

      const data = {
        shopDomain: input.shopDomain,
        storefrontToken: input.storefrontToken,
        sellerName: input.sellerName,
        currency: input.currency,
      };
      const config = await prisma.checkoutConfiguration.upsert({
        where: { siteId: input.siteId },
        create: { siteId: input.siteId, createdById: ctx.user.id, ...data },
        update: data,
        select: CHECKOUT_PUBLIC_FIELDS,
      });

      await recordAudit({
        type: "CheckoutConfigured",
        workspaceId: site.workspaceId,
        projectId: site.projectId,
        actorId: ctx.user.id,
        // The token is deliberately absent from the audit payload.
        payload: { siteId: site.id, shopDomain: input.shopDomain, sellerName: input.sellerName },
      });
      return config;
    }),

  listListings: protectedProcedure
    .input(z.object({ siteId: z.string() }))
    .query(async ({ ctx, input }) => {
      await siteWithAccess(ctx.user.id, input.siteId, "project.read");
      return prisma.listing.findMany({
        where: { siteId: input.siteId },
        include: { release: { select: { id: true, version: true } } },
        orderBy: { createdAt: "desc" },
      });
    }),

  addListing: protectedProcedure
    .input(
      z.object({
        siteId: z.string(),
        externalHandle: z.string().trim().min(1).max(255),
        saleMode: z.enum(SALE_MODES).default("PHYSICAL"),
        releaseId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const site = await siteWithAccess(ctx.user.id, input.siteId, "commerce.manage");

      const credentials = credentialsOf(site);
      if (!credentials) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Connect a Shopify store before adding listings.",
        });
      }

      if (input.releaseId) {
        const release = await prisma.release.findUnique({ where: { id: input.releaseId } });
        if (!release || (site.projectId && release.projectId !== site.projectId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown release for this site" });
        }
      }

      // Snapshot title and price from the merchant's store at add time.
      const product = await getCommerce(credentials).getProduct(input.externalHandle);
      if (!product.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: product.error });

      const listing = await prisma.listing.create({
        data: {
          siteId: site.id,
          releaseId: input.releaseId ?? site.releaseId,
          saleMode: input.saleMode,
          title: product.data.title,
          priceCents: product.data.priceCents,
          currency: product.data.currency,
          externalHandle: input.externalHandle,
          externalVariantId: product.data.variantId,
          createdById: ctx.user.id,
        },
      });

      await recordAudit({
        type: "ListingCreated",
        workspaceId: site.workspaceId,
        projectId: site.projectId,
        actorId: ctx.user.id,
        payload: { siteId: site.id, listingId: listing.id, handle: input.externalHandle },
      });
      return listing;
    }),

  /** Makes a listing publicly purchasable. Enforces PRD 14.5 and 24.4. */
  activateListing: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const listing = await prisma.listing.findUnique({ where: { id: input.id } });
      if (!listing) throw new TRPCError({ code: "NOT_FOUND" });
      const site = await siteWithAccess(ctx.user.id, listing.siteId, "commerce.manage");

      const credentials = credentialsOf(site);
      // Re-resolve rather than trusting the snapshot: stock and price move.
      const product = credentials
        ? await getCommerce(credentials).getProduct(listing.externalHandle)
        : null;
      if (product && !product.ok) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: product.error });
      }

      const decision = canActivateListing({
        releaseId: listing.releaseId,
        checkout: site.checkout
          ? { sellerName: site.checkout.sellerName, shopDomain: site.checkout.shopDomain }
          : null,
        siteSimulated: site.simulated,
        productAvailable: product?.ok ? product.data.availableForSale : false,
      });
      if (!decision.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: decision.reason });
      }

      const updated = await prisma.listing.update({
        where: { id: listing.id },
        data: {
          status: "ACTIVE",
          title: product?.ok ? product.data.title : listing.title,
          priceCents: product?.ok ? product.data.priceCents : listing.priceCents,
          currency: product?.ok ? product.data.currency : listing.currency,
          externalVariantId: product?.ok ? product.data.variantId : listing.externalVariantId,
        },
      });

      await recordAudit({
        type: "ListingPublished",
        workspaceId: site.workspaceId,
        projectId: site.projectId,
        actorId: ctx.user.id,
        payload: {
          siteId: site.id,
          listingId: listing.id,
          releaseId: listing.releaseId,
          priceCents: updated.priceCents,
        },
      });
      return updated;
    }),

  archiveListing: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const listing = await prisma.listing.findUnique({ where: { id: input.id } });
      if (!listing) throw new TRPCError({ code: "NOT_FOUND" });
      const site = await siteWithAccess(ctx.user.id, listing.siteId, "commerce.manage");

      const updated = await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "ARCHIVED" },
      });

      await recordAudit({
        type: "ListingArchived",
        workspaceId: site.workspaceId,
        projectId: site.projectId,
        actorId: ctx.user.id,
        payload: { siteId: site.id, listingId: listing.id },
      });
      return updated;
    }),

  /**
   * Mints a hosted checkout URL. Deliberately not persisted — Shopify treats
   * these as short-lived, so each buyer gets a fresh one.
   */
  startCheckout: protectedProcedure
    .input(
      z.object({ listingId: z.string(), quantity: z.number().int().min(1).max(100).default(1) }),
    )
    .mutation(async ({ ctx, input }) => {
      const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
      if (!listing) throw new TRPCError({ code: "NOT_FOUND" });
      const site = await siteWithAccess(ctx.user.id, listing.siteId, "project.read");

      if (listing.status !== "ACTIVE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This listing is not active, so it cannot be purchased.",
        });
      }
      if (!listing.externalVariantId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This listing has no variant" });
      }

      const result = await getCommerce(credentialsOf(site)).createCheckout([
        { variantId: listing.externalVariantId, quantity: input.quantity },
      ]);
      if (!result.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: result.error });

      await recordAudit({
        type: "CheckoutStarted",
        workspaceId: site.workspaceId,
        projectId: site.projectId,
        actorId: ctx.user.id,
        payload: { siteId: site.id, listingId: listing.id, quantity: input.quantity },
      });
      return result.data;
    }),
});
