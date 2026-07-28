/**
 * Listing activation policy.
 *
 * PRD 14.5: a public listing MUST reference a release and MUST NOT read
 * mutable branch data. PRD 24.4: checkout requires a release and a seller
 * identity. These are pure so the rules are testable without a database,
 * and the router refuses to activate a listing unless this passes.
 */

export type ListingActivationInput = {
  /** Release the listing is pinned to. Null means drafted from live data. */
  releaseId: string | null;
  /** The site's checkout configuration, if one has been set up. */
  checkout: { sellerName: string; shopDomain: string } | null;
  /** True when the site itself was produced by the SIMULATED builder. */
  siteSimulated: boolean;
  /** Whether the merchant's store currently reports the variant as sellable. */
  productAvailable: boolean;
};

export type ListingActivation = { ok: true } | { ok: false; reason: string };

export function canActivateListing(input: ListingActivationInput): ListingActivation {
  if (input.siteSimulated) {
    return {
      ok: false,
      reason: "This site is SIMULATED. Generate a real site before selling from it.",
    };
  }
  if (!input.releaseId) {
    return {
      ok: false,
      reason:
        "A public listing must reference a release. Create a release before activating checkout.",
    };
  }
  if (!input.checkout) {
    return { ok: false, reason: "Connect a Shopify store before activating checkout." };
  }
  if (!input.checkout.sellerName.trim()) {
    return { ok: false, reason: "Checkout requires a seller identity on the store connection." };
  }
  if (!input.productAvailable) {
    return { ok: false, reason: "The connected Shopify product is not available for sale." };
  }
  return { ok: true };
}
