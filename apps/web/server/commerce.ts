import "server-only";
import {
  createShopifyCommerce,
  createSimulatedCommerce,
  type CommercePort,
} from "@foundry/commerce";

export type StoreCredentials = { shopDomain: string; storefrontToken: string };

/**
 * Commerce port for one site. Credentials live per-site on
 * CheckoutConfiguration rather than in env, because each workspace sells
 * from its own Shopify store. Sites with no store connected get the
 * SIMULATED adapter, which never mints a checkout URL.
 */
export function getCommerce(credentials: StoreCredentials | null): CommercePort {
  if (!credentials) return createSimulatedCommerce();
  return createShopifyCommerce(credentials);
}
