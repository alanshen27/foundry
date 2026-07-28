import type { CommercePort } from "./port";

/**
 * SIMULATED commerce adapter for dev/e2e without a Shopify store.
 *
 * It resolves a fake product so the listing UI is exercisable, but it never
 * mints a checkout URL — simulated commerce must not produce something that
 * looks like a real place to pay (AGENTS.md rule 3).
 */
export function createSimulatedCommerce(): CommercePort {
  return {
    async getProduct(handle) {
      return {
        ok: true,
        data: {
          variantId: `simulated-variant/${handle}`,
          title: `SIMULATED ${handle}`,
          priceCents: 0,
          currency: "USD",
          availableForSale: false,
        },
      };
    },

    async createCheckout() {
      return {
        ok: false,
        error: "Commerce is SIMULATED. Connect a Shopify store to take real orders.",
      };
    },
  };
}
