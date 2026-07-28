"use client";

import { useState } from "react";
import { Loader2, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

const SALE_MODES = [
  ["PHYSICAL", "Physical product"],
  ["PREORDER", "Preorder / reservation"],
  ["KIT", "DIY kit"],
  ["PCB_ONLY", "PCB only"],
  ["MECHANICAL_FILES", "Mechanical files"],
  ["DESIGN_BUNDLE", "Design bundle"],
  ["LICENSE", "License"],
  ["TEMPLATE", "Project template"],
] as const;

function formatPrice(cents: number | null, currency: string | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency ?? "USD",
  }).format(cents / 100);
}

/**
 * Shopify connection and listings for one site. Shopify owns catalog,
 * payment, and the hosted checkout — a listing here points at a product in
 * the merchant's store and cannot go live without a release (PRD 14.5).
 */
export function CommercePanel({ siteId, canManage }: { siteId: string; canManage: boolean }) {
  const utils = trpc.useUtils();
  const config = trpc.commerce.getCheckoutConfig.useQuery({ siteId });
  const listings = trpc.commerce.listListings.useQuery({ siteId });

  const [shopDomain, setShopDomain] = useState("");
  const [storefrontToken, setStorefrontToken] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [handle, setHandle] = useState("");
  const [saleMode, setSaleMode] = useState<(typeof SALE_MODES)[number][0]>("PHYSICAL");
  const [error, setError] = useState<string | null>(null);

  const onError = (e: { message: string }) => setError(e.message);
  const refresh = async () => {
    await Promise.all([
      utils.commerce.getCheckoutConfig.invalidate({ siteId }),
      utils.commerce.listListings.invalidate({ siteId }),
    ]);
  };

  const configure = trpc.commerce.configureCheckout.useMutation({
    onSuccess: async () => {
      setStorefrontToken("");
      setError(null);
      await refresh();
    },
    onError,
  });
  const addListing = trpc.commerce.addListing.useMutation({
    onSuccess: async () => {
      setHandle("");
      setError(null);
      await refresh();
    },
    onError,
  });
  const activate = trpc.commerce.activateListing.useMutation({
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError,
  });
  const archive = trpc.commerce.archiveListing.useMutation({
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError,
  });

  const busy =
    configure.isPending || addListing.isPending || activate.isPending || archive.isPending;
  const connected = Boolean(config.data);

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <Store className="size-4" strokeWidth={1.75} />
        <h2 className="text-[13px] font-medium">Commerce</h2>
        {connected ? (
          <Badge variant="secondary">{config.data?.shopDomain}</Badge>
        ) : (
          <Badge variant="outline">No store connected</Badge>
        )}
      </div>

      {error ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-[12px]">
          {error}
        </div>
      ) : null}

      {canManage ? (
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            configure.mutate({ siteId, shopDomain, storefrontToken, sellerName });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="shop-domain">Shop domain</Label>
            <Input
              id="shop-domain"
              value={shopDomain}
              onChange={(e) => setShopDomain(e.target.value)}
              placeholder="my-store.myshopify.com"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="storefront-token">Storefront token</Label>
            <Input
              id="storefront-token"
              type="password"
              value={storefrontToken}
              onChange={(e) => setStorefrontToken(e.target.value)}
              placeholder="Storefront API access token"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seller-name">Seller name</Label>
            <Input
              id="seller-name"
              value={sellerName}
              onChange={(e) => setSellerName(e.target.value)}
              placeholder="Foundry Robotics Ltd"
              required
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" disabled={busy}>
            {configure.isPending ? <Loader2 className="animate-spin" /> : null}
            {connected ? "Update store" : "Connect store"}
          </Button>
        </form>
      ) : null}

      {canManage && connected ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addListing.mutate({ siteId, externalHandle: handle, saleMode });
          }}
        >
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <Label htmlFor="product-handle">Shopify product handle</Label>
            <Input
              id="product-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="palm-rover"
              required
            />
          </div>
          <select
            aria-label="Sale mode"
            className="border-input bg-background h-9 rounded-lg border px-3 text-sm"
            value={saleMode}
            onChange={(e) => setSaleMode(e.target.value as (typeof SALE_MODES)[number][0])}
          >
            {SALE_MODES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" size="sm" disabled={busy || !handle.trim()}>
            {addListing.isPending ? <Loader2 className="animate-spin" /> : null}
            Add listing
          </Button>
        </form>
      ) : null}

      {listings.data?.length ? (
        <ul className="divide-y rounded-lg border">
          {listings.data.map((listing) => (
            <li key={listing.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="flex-1 truncate text-[13px]">{listing.title}</span>
              <span className="text-muted-foreground text-[12px]">
                {formatPrice(listing.priceCents, listing.currency)}
              </span>
              <Badge variant={listing.status === "ACTIVE" ? "default" : "outline"}>
                {listing.status}
              </Badge>
              {listing.release ? (
                <Badge variant="secondary">{listing.release.version}</Badge>
              ) : (
                <Badge variant="destructive">No release</Badge>
              )}
              {canManage ? (
                <span className="flex gap-1">
                  {listing.status !== "ACTIVE" ? (
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => activate.mutate({ id: listing.id })}
                    >
                      Activate
                    </Button>
                  ) : null}
                  {listing.status !== "ARCHIVED" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => archive.mutate({ id: listing.id })}
                    >
                      Archive
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-[12px]">
          {connected
            ? "No listings yet. Add a product handle from your Shopify store."
            : "Connect a Shopify store to sell this product. Shopify handles payment and checkout."}
        </p>
      )}
    </div>
  );
}
