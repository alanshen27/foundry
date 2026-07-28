import { describe, expect, it } from "vitest";
import { canActivateListing, type ListingActivationInput } from "../src";

const valid: ListingActivationInput = {
  releaseId: "rel_1",
  checkout: { sellerName: "Foundry Robotics", shopDomain: "demo.myshopify.com" },
  siteSimulated: false,
  productAvailable: true,
};

describe("canActivateListing", () => {
  it("allows a released, connected, available listing", () => {
    expect(canActivateListing(valid)).toEqual({ ok: true });
  });

  // PRD 14.5: a public listing MUST reference a release.
  it("refuses a listing with no release", () => {
    const result = canActivateListing({ ...valid, releaseId: null });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("must reference a release");
  });

  // PRD 24.4: checkout requires a release and seller identity.
  it("refuses a listing with no store connected", () => {
    const result = canActivateListing({ ...valid, checkout: null });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("Connect a Shopify store");
  });

  it("refuses a listing whose seller identity is blank", () => {
    const result = canActivateListing({
      ...valid,
      checkout: { sellerName: "   ", shopDomain: "demo.myshopify.com" },
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("seller identity");
  });

  it("refuses to sell from a SIMULATED site", () => {
    const result = canActivateListing({ ...valid, siteSimulated: true });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("SIMULATED");
  });

  it("refuses a product the store reports as unavailable", () => {
    const result = canActivateListing({ ...valid, productAvailable: false });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("not available for sale");
  });

  it("checks the simulated site before anything else", () => {
    // A simulated site with nothing else set up should still name the real blocker.
    const result = canActivateListing({
      releaseId: null,
      checkout: null,
      siteSimulated: true,
      productAvailable: false,
    });

    expect(!result.ok && result.reason).toContain("SIMULATED");
  });
});
