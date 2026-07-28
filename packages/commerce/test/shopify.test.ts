import { describe, expect, it } from "vitest";
import { createShopifyCommerce, createSimulatedCommerce, toMinorUnits } from "../src";

type RecordedCall = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recordingFetch(respond: () => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function callAt(calls: RecordedCall[], index = 0): RecordedCall {
  const call = calls[index];
  if (!call) throw new Error(`no fetch call recorded at index ${index}`);
  return call;
}

function shopWith(fetchImpl: typeof fetch) {
  return createShopifyCommerce({
    shopDomain: "demo.myshopify.com",
    storefrontToken: "tok",
    fetchImpl,
  });
}

describe("toMinorUnits", () => {
  it("converts decimal strings without float rounding", () => {
    expect(toMinorUnits("19.99")).toBe(1999);
    expect(toMinorUnits("0.07")).toBe(7);
    expect(toMinorUnits("100")).toBe(10000);
    expect(toMinorUnits("100.5")).toBe(10050);
    expect(toMinorUnits("1234.56")).toBe(123456);
  });

  it("rejects values it cannot read exactly", () => {
    expect(toMinorUnits("free")).toBeNull();
    expect(toMinorUnits("")).toBeNull();
  });
});

describe("createShopifyCommerce", () => {
  it("resolves a product to a purchasable variant", async () => {
    const { impl, calls } = recordingFetch(() =>
      jsonResponse({
        data: {
          product: {
            title: "Palm Rover",
            variants: {
              nodes: [
                {
                  id: "gid://shopify/ProductVariant/1",
                  title: "Default",
                  availableForSale: true,
                  price: { amount: "249.00", currencyCode: "USD" },
                },
              ],
            },
          },
        },
      }),
    );

    const result = await shopWith(impl).getProduct("palm-rover");

    expect(result).toEqual({
      ok: true,
      data: {
        variantId: "gid://shopify/ProductVariant/1",
        title: "Palm Rover",
        priceCents: 24900,
        currency: "USD",
        availableForSale: true,
      },
    });
    expect(callAt(calls).url).toBe("https://demo.myshopify.com/api/2026-07/graphql.json");
    expect(callAt(calls).init.headers).toMatchObject({
      "X-Shopify-Storefront-Access-Token": "tok",
    });
  });

  it("reports a missing product instead of returning an empty listing", async () => {
    const { impl } = recordingFetch(() => jsonResponse({ data: { product: null } }));

    const result = await shopWith(impl).getProduct("nope");

    expect(result).toEqual({ ok: false, error: 'No Shopify product with handle "nope"' });
  });

  it("surfaces GraphQL errors returned inside a 200 body", async () => {
    const { impl } = recordingFetch(() =>
      jsonResponse({ data: null, errors: [{ message: "Access denied" }] }),
    );

    const result = await shopWith(impl).getProduct("palm-rover");

    expect(result).toEqual({ ok: false, error: "Shopify: Access denied" });
  });

  it("mints a checkout URL from a cart", async () => {
    const { impl, calls } = recordingFetch(() =>
      jsonResponse({
        data: {
          cartCreate: {
            cart: {
              id: "gid://shopify/Cart/1",
              checkoutUrl: "https://demo.myshopify.com/cart/c/1",
            },
            userErrors: [],
          },
        },
      }),
    );

    const result = await shopWith(impl).createCheckout([
      { variantId: "gid://shopify/ProductVariant/1", quantity: 2 },
    ]);

    expect(result).toEqual({
      ok: true,
      data: { checkoutUrl: "https://demo.myshopify.com/cart/c/1" },
    });
    const body = JSON.parse(callAt(calls).init.body as string) as {
      variables: { lines: unknown[] };
    };
    expect(body.variables.lines).toEqual([
      { merchandiseId: "gid://shopify/ProductVariant/1", quantity: 2 },
    ]);
  });

  it("surfaces cart user errors", async () => {
    const { impl } = recordingFetch(() =>
      jsonResponse({
        data: { cartCreate: { cart: null, userErrors: [{ message: "Variant sold out" }] } },
      }),
    );

    const result = await shopWith(impl).createCheckout([{ variantId: "v", quantity: 1 }]);

    expect(result).toEqual({ ok: false, error: "Shopify: Variant sold out" });
  });

  it("refuses an empty cart without calling Shopify", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse({}));

    const result = await shopWith(impl).createCheckout([]);

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("returns an error instead of throwing when Shopify is unreachable", async () => {
    const { impl } = recordingFetch(() => {
      throw new Error("ENOTFOUND");
    });

    const result = await shopWith(impl).getProduct("palm-rover");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("Could not reach Shopify");
  });
});

describe("createSimulatedCommerce", () => {
  it("never mints a checkout URL", async () => {
    const result = await createSimulatedCommerce().createCheckout([
      { variantId: "v", quantity: 1 },
    ]);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("SIMULATED");
  });

  it("marks simulated products as not sellable", async () => {
    const result = await createSimulatedCommerce().getProduct("palm-rover");

    expect(result.ok && result.data.availableForSale).toBe(false);
  });
});
