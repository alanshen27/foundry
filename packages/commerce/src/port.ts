/**
 * CommercePort: the only commerce surface app code may use.
 *
 * Implementation: the Shopify Storefront API. Shopify owns the catalog,
 * inventory, payment, tax, and the hosted checkout — FOUNDRY resolves a
 * product and mints a checkout URL, and never touches payment details.
 */

/** A product variant as the merchant's store reports it right now. */
export type CommerceProduct = {
  /** Variant id used as the checkout line item (Shopify: a variant GID). */
  variantId: string;
  title: string;
  /** Minor units, matching the repo's *Cents convention. */
  priceCents: number;
  currency: string;
  availableForSale: boolean;
};

export type CommerceCheckout = {
  /**
   * Hosted checkout URL. Minted per request and never persisted: Shopify
   * treats these as short-lived and they go stale.
   */
  checkoutUrl: string;
};

export type CommerceLine = {
  variantId: string;
  quantity: number;
};

export type CommerceResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type CommerceOptions = {
  signal?: AbortSignal;
};

export interface CommercePort {
  /** Resolve a product handle to a purchasable variant. */
  getProduct(handle: string, opts?: CommerceOptions): Promise<CommerceResult<CommerceProduct>>;
  /** Create a cart and return its hosted checkout URL. */
  createCheckout(
    lines: readonly CommerceLine[],
    opts?: CommerceOptions,
  ): Promise<CommerceResult<CommerceCheckout>>;
}
