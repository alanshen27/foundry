"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Boxes,
  CreditCard,
  Loader2,
  PackageCheck,
  PlugZap,
  ReceiptText,
  Settings2,
  ShoppingBag,
  Store,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

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

type CommerceView = "overview" | "products" | "orders" | "settings";

function formatPrice(cents: number | null, currency: string | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency ?? "USD",
  }).format(cents / 100);
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Store;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="bg-card rounded-xl border p-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-2 text-lg font-semibold tracking-tight">{value}</p>
      <p className="text-muted-foreground mt-0.5 truncate text-[11px]">{detail}</p>
    </div>
  );
}

/**
 * Native commerce workspace for one site. Product/catalog and checkout data
 * are real Shopify Storefront API capabilities. Orders are deliberately
 * labeled unavailable until an Admin API + webhook adapter exists.
 */
export function CommercePanel({ siteId, canManage }: { siteId: string; canManage: boolean }) {
  const utils = trpc.useUtils();
  const capabilities = trpc.commerce.capabilities.useQuery({ siteId });
  const config = trpc.commerce.getCheckoutConfig.useQuery({ siteId });
  const listings = trpc.commerce.listListings.useQuery({ siteId });

  const [view, setView] = useState<CommerceView>("overview");
  const [shopDomain, setShopDomain] = useState("");
  const [storefrontToken, setStorefrontToken] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [handle, setHandle] = useState("");
  const [saleMode, setSaleMode] = useState<(typeof SALE_MODES)[number][0]>("PHYSICAL");
  const [error, setError] = useState<string | null>(null);

  const onError = (nextError: { message: string }) => setError(nextError.message);
  const refresh = async () => {
    await Promise.all([
      utils.commerce.getCheckoutConfig.invalidate({ siteId }),
      utils.commerce.listListings.invalidate({ siteId }),
      utils.site.list.invalidate(),
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

  const items = useMemo(() => listings.data ?? [], [listings.data]);
  const activeListings = items.filter((listing) => listing.status === "ACTIVE").length;
  const catalogValue = items.reduce((sum, listing) => sum + (listing.priceCents ?? 0), 0);
  const currency = items.find((listing) => listing.currency)?.currency ?? config.data?.currency;
  const connected = Boolean(config.data);
  const busy =
    configure.isPending || addListing.isPending || activate.isPending || archive.isPending;

  const navigation: { id: CommerceView; label: string; icon: typeof Store }[] = [
    { id: "overview", label: "Overview", icon: Store },
    { id: "products", label: "Products", icon: ShoppingBag },
    { id: "orders", label: "Orders", icon: ReceiptText },
    { id: "settings", label: "Settings", icon: Settings2 },
  ];

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside className="bg-card/40 w-44 shrink-0 border-r p-2">
        <div className="mb-2 flex items-center gap-2 px-2 py-2">
          <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-lg">
            <Store className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">Commerce</p>
            <p className="text-muted-foreground truncate text-[10px]">
              {config.data?.shopDomain ?? "Not connected"}
            </p>
          </div>
        </div>
        <nav className="space-y-0.5" aria-label="Commerce">
          {navigation.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                view === item.id
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
              {item.id === "orders" && !capabilities.data?.orders ? (
                <span className="bg-muted-foreground/50 ml-auto size-1.5 rounded-full" />
              ) : null}
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        {error ? (
          <div className="border-destructive/30 bg-destructive/5 text-destructive mb-4 rounded-lg border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}

        {view === "overview" ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold">Store overview</h2>
              <p className="text-muted-foreground mt-1 text-xs">
                Live catalog and checkout state for this site.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                icon={PlugZap}
                label="Store"
                value={connected ? "Connected" : "Offline"}
                detail={config.data?.shopDomain ?? "Connect Shopify in Settings"}
              />
              <Stat
                icon={Boxes}
                label="Listings"
                value={String(items.length)}
                detail={`${activeListings} active`}
              />
              <Stat
                icon={CreditCard}
                label="Catalog value"
                value={formatPrice(catalogValue, currency ?? null)}
                detail="Current listing snapshots"
              />
              <Stat
                icon={ReceiptText}
                label="Orders"
                value={capabilities.data?.orders ? "Synced" : "Unavailable"}
                detail="Admin connection required"
              />
            </div>

            <section className="bg-card rounded-xl border p-4">
              <div className="flex items-start gap-3">
                <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <PackageCheck className="size-4" />
                </span>
                <div>
                  <h3 className="text-sm font-medium">Native checkout</h3>
                  <p className="text-muted-foreground mt-1 text-xs leading-5">
                    Foundry reads Shopify products and availability, then creates a fresh hosted
                    checkout for active release-backed listings. Payments, tax, inventory, and
                    fulfillment stay in Shopify.
                  </p>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {view === "products" ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold">Products</h2>
              <p className="text-muted-foreground mt-1 text-xs">
                Listings linked to immutable Foundry releases.
              </p>
            </div>

            {canManage && connected ? (
              <form
                className="bg-card flex flex-wrap items-end gap-2 rounded-xl border p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  addListing.mutate({ siteId, externalHandle: handle, saleMode });
                }}
              >
                <div className="min-w-[220px] flex-1 space-y-1.5">
                  <Label htmlFor={`product-handle-${siteId}`}>Shopify product handle</Label>
                  <Input
                    id={`product-handle-${siteId}`}
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    placeholder="palm-rover"
                    required
                  />
                </div>
                <select
                  aria-label="Sale mode"
                  className="border-input bg-background h-9 rounded-lg border px-3 text-sm"
                  value={saleMode}
                  onChange={(event) =>
                    setSaleMode(event.target.value as (typeof SALE_MODES)[number][0])
                  }
                >
                  {SALE_MODES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  disabled={busy || !handle.trim()}
                >
                  {addListing.isPending ? <Loader2 className="animate-spin" /> : null}
                  Add listing
                </Button>
              </form>
            ) : null}

            {items.length ? (
              <div className="overflow-hidden rounded-xl border">
                <div className="bg-muted/40 text-muted-foreground grid grid-cols-[minmax(0,1fr)_110px_90px_120px] gap-3 border-b px-4 py-2 text-[10px] font-semibold tracking-wider uppercase">
                  <span>Product</span>
                  <span>Price</span>
                  <span>Status</span>
                  <span>Release</span>
                </div>
                {items.map((listing) => (
                  <div
                    key={listing.id}
                    className="grid grid-cols-[minmax(0,1fr)_110px_90px_120px] items-center gap-3 border-b px-4 py-3 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{listing.title}</p>
                      <p className="text-muted-foreground truncate text-[10px]">
                        /{listing.externalHandle}
                      </p>
                    </div>
                    <span className="text-xs">
                      {formatPrice(listing.priceCents, listing.currency)}
                    </span>
                    <Badge variant={listing.status === "ACTIVE" ? "default" : "outline"}>
                      {listing.status}
                    </Badge>
                    <div className="flex items-center justify-between gap-1">
                      {listing.release ? (
                        <span className="text-xs">{listing.release.version}</span>
                      ) : (
                        <span className="text-destructive text-[10px]">No release</span>
                      )}
                      {canManage ? (
                        listing.status !== "ACTIVE" ? (
                          <Button
                            size="xs"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => activate.mutate({ id: listing.id })}
                          >
                            Activate
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => archive.mutate({ id: listing.id })}
                          >
                            Archive
                          </Button>
                        )
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
                <ShoppingBag className="mb-3 size-5" />
                <p className="text-foreground text-sm font-medium">No products yet</p>
                <p className="mt-1 text-xs">
                  {connected
                    ? "Add a Shopify product handle above."
                    : "Connect Shopify in Settings before adding products."}
                </p>
              </div>
            )}
          </div>
        ) : null}

        {view === "orders" ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold">Orders</h2>
              <p className="text-muted-foreground mt-1 text-xs">
                Fulfillment and customer order activity.
              </p>
            </div>
            <div className="border-amber-500/30 bg-amber-500/5 flex items-start gap-3 rounded-xl border p-4">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <h3 className="text-sm font-medium">Order sync is not connected</h3>
                <p className="text-muted-foreground mt-1 max-w-2xl text-xs leading-5">
                  {capabilities.data?.ordersReason ??
                    "The current commerce adapter does not expose orders."}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {view === "settings" ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold">Commerce settings</h2>
              <p className="text-muted-foreground mt-1 text-xs">
                Connect the Shopify store that owns this site&apos;s catalog and checkout.
              </p>
            </div>
            {canManage ? (
              <form
                className="bg-card grid max-w-3xl gap-4 rounded-xl border p-4 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  configure.mutate({ siteId, shopDomain, storefrontToken, sellerName });
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor={`shop-domain-${siteId}`}>Shop domain</Label>
                  <Input
                    id={`shop-domain-${siteId}`}
                    value={shopDomain}
                    onChange={(event) => setShopDomain(event.target.value)}
                    placeholder={config.data?.shopDomain ?? "my-store.myshopify.com"}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`seller-name-${siteId}`}>Seller name</Label>
                  <Input
                    id={`seller-name-${siteId}`}
                    value={sellerName}
                    onChange={(event) => setSellerName(event.target.value)}
                    placeholder={config.data?.sellerName ?? "Foundry Robotics Ltd"}
                    required
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`storefront-token-${siteId}`}>Storefront API token</Label>
                  <Input
                    id={`storefront-token-${siteId}`}
                    type="password"
                    value={storefrontToken}
                    onChange={(event) => setStorefrontToken(event.target.value)}
                    placeholder="Storefront API access token"
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={busy}>
                    {configure.isPending ? <Loader2 className="animate-spin" /> : null}
                    {connected ? "Update connection" : "Connect Shopify"}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-muted-foreground text-xs">
                You do not have permission to manage commerce settings.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
