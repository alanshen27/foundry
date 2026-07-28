import { z } from "zod";
import type {
  CommerceCheckout,
  CommerceLine,
  CommerceOptions,
  CommercePort,
  CommerceProduct,
  CommerceResult,
} from "./port";

/**
 * Storefront API version. Shopify ships four a year and removes old ones;
 * 2026-01 is where Cart fully replaced the legacy Checkout object, so this
 * adapter targets Cart only.
 */
export const SHOPIFY_API_VERSION = "2026-07";

const moneySchema = z.object({ amount: z.string(), currencyCode: z.string() });

const variantSchema = z.object({
  id: z.string(),
  title: z.string(),
  availableForSale: z.boolean(),
  price: moneySchema,
});

const productQuerySchema = z.object({
  data: z
    .object({
      product: z
        .object({
          title: z.string(),
          variants: z.object({ nodes: z.array(variantSchema) }),
        })
        .nullable(),
    })
    .nullable(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

const cartCreateSchema = z.object({
  data: z
    .object({
      cartCreate: z
        .object({
          cart: z.object({ id: z.string(), checkoutUrl: z.string() }).nullable(),
          userErrors: z.array(z.object({ message: z.string() })),
        })
        .nullable(),
    })
    .nullable(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

const PRODUCT_QUERY = `
  query product($handle: String!) {
    product(handle: $handle) {
      title
      variants(first: 1) {
        nodes { id title availableForSale price { amount currencyCode } }
      }
    }
  }
`;

const CART_CREATE = `
  mutation cartCreate($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) {
      cart { id checkoutUrl }
      userErrors { message }
    }
  }
`;

/**
 * Shopify prices are decimal strings ("19.99"). Parse to minor units without
 * float rounding, so 19.99 never becomes 1998.
 */
export function toMinorUnits(amount: string): number | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,}))?$/.exec(amount.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const cents = `${fraction}00`.slice(0, 2);
  const value = Number(whole) * 100 + Number(cents);
  return sign === "-" ? -value : value;
}

export type ShopifyCommerceOptions = {
  /** e.g. `my-store.myshopify.com`. */
  shopDomain: string;
  /** Storefront access token (public-scope, browser-safe by design). */
  storefrontToken: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
};

export function createShopifyCommerce(options: ShopifyCommerceOptions): CommercePort {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const endpoint = `https://${options.shopDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/api/${
    options.apiVersion ?? SHOPIFY_API_VERSION
  }/graphql.json`;

  async function graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<CommerceResult<T>> {
    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": options.storefrontToken,
        },
        body: JSON.stringify({ query, variables }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) return { ok: false, error: "Cancelled" };
      return { ok: false, error: `Could not reach Shopify: ${String(error)}` };
    }

    if (!response.ok) {
      return { ok: false, error: `Shopify returned ${response.status}` };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, error: "Shopify returned a malformed response" };
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, error: `Unexpected Shopify response: ${parsed.error.message}` };
    }
    return { ok: true, data: parsed.data };
  }

  return {
    async getProduct(handle, opts?: CommerceOptions) {
      const result = await graphql(PRODUCT_QUERY, { handle }, productQuerySchema, opts?.signal);
      if (!result.ok) return result;

      // GraphQL reports business errors in a 200 body.
      const topLevel = result.data.errors?.[0]?.message;
      if (topLevel) return { ok: false, error: `Shopify: ${topLevel}` };

      const product = result.data.data?.product;
      if (!product) return { ok: false, error: `No Shopify product with handle "${handle}"` };

      const variant = product.variants.nodes[0];
      if (!variant) return { ok: false, error: `Product "${handle}" has no purchasable variant` };

      const priceCents = toMinorUnits(variant.price.amount);
      if (priceCents === null) {
        return { ok: false, error: `Could not read the price of "${handle}"` };
      }

      const data: CommerceProduct = {
        variantId: variant.id,
        title: product.title,
        priceCents,
        currency: variant.price.currencyCode,
        availableForSale: variant.availableForSale,
      };
      return { ok: true, data };
    },

    async createCheckout(lines: readonly CommerceLine[], opts?: CommerceOptions) {
      if (lines.length === 0) {
        return { ok: false, error: "Cannot create a checkout with no line items" };
      }

      const result = await graphql(
        CART_CREATE,
        {
          lines: lines.map((line) => ({
            merchandiseId: line.variantId,
            quantity: line.quantity,
          })),
        },
        cartCreateSchema,
        opts?.signal,
      );
      if (!result.ok) return result;

      const topLevel = result.data.errors?.[0]?.message;
      if (topLevel) return { ok: false, error: `Shopify: ${topLevel}` };

      const payload = result.data.data?.cartCreate;
      const userError = payload?.userErrors[0]?.message;
      if (userError) return { ok: false, error: `Shopify: ${userError}` };
      if (!payload?.cart) return { ok: false, error: "Shopify did not return a cart" };

      const checkout: CommerceCheckout = { checkoutUrl: payload.cart.checkoutUrl };
      return { ok: true, data: checkout };
    },
  };
}
