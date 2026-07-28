"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowUpRight,
  Clock3,
  Globe,
  LayoutTemplate,
  Loader2,
  ShoppingBag,
  Sparkles,
  Store,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

type WorkspaceProject = { id: string; name: string; slug: string };

function updatedLabel(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round((date.getTime() - Date.now()) / 86_400_000),
    "day",
  );
}

function nameFromPrompt(prompt: string): string {
  const cleaned = prompt
    .trim()
    .replace(/^["']|["']$/g, "")
    .split(/[.!?\n]/)[0]
    ?.trim()
    .slice(0, 48);
  return cleaned && cleaned.length >= 3 ? cleaned : "Untitled site";
}

/**
 * Lovable-style creation surface: giant prompt first, library second.
 * Sharp Foundry chrome (signal orange, square corners) — not soft SaaS cards.
 */
export function SitesPanel({
  workspaceId,
  workspaceSlug,
  projects,
  canEdit,
}: {
  workspaceId: string;
  workspaceSlug: string;
  projects: WorkspaceProject[];
  canEdit: boolean;
  canPublish: boolean;
  canManageCommerce: boolean;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const builderStatus = trpc.site.builderStatus.useQuery();
  const sites = trpc.site.list.useQuery({ workspaceId });

  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);

  const create = trpc.site.create.useMutation({
    onSuccess: async (site) => {
      await utils.site.list.invalidate({ workspaceId });
      setPrompt("");
      setError(null);
      router.push(`/w/${workspaceSlug}/sites/${site.slug}/editor`);
    },
    onError: (nextError) => setError(nextError.message),
  });

  const hasSites = Boolean(sites.data?.length);
  const simulated = builderStatus.data && !builderStatus.data.configured;

  function submit() {
    if (!canEdit || !prompt.trim() || create.isPending) return;
    create.mutate({
      workspaceId,
      name: nameFromPrompt(prompt),
      prompt: prompt.trim(),
      projectId: projectId || undefined,
    });
  }

  return (
    <div className="space-y-10">
      {/* Create hero — open on the page, no outer card */}
      <section className="relative">
        <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-2 py-10 text-center sm:py-16">
          <p className="text-muted-foreground font-mono text-[11px] tracking-[0.18em] uppercase">
            Sites
          </p>
          <h2 className="mt-3 font-mono text-[clamp(1.75rem,4vw,2.75rem)] leading-[1.05] font-medium tracking-[-0.04em]">
            Build something Foundry
          </h2>
          <p className="text-muted-foreground mt-3 max-w-lg text-[15px] leading-relaxed">
            Describe a launch page or storefront. AI drafts it — then you refine beside live preview
            and code.
          </p>

          {simulated ? (
            <p className="border-destructive/40 bg-destructive/10 text-destructive mt-5 border px-3 py-2 font-mono text-[11px] tracking-wide">
              SIMULATED builder — set V0_API_KEY for real generation
            </p>
          ) : (
            <p className="text-muted-foreground mt-5 font-mono text-[11px] tracking-[0.12em] uppercase">
              v0 connected
            </p>
          )}

          {error ? (
            <p
              role="alert"
              className="border-destructive/40 bg-destructive/10 text-destructive mt-4 w-full border px-3 py-2 text-left font-mono text-[12px]"
            >
              {error}
            </p>
          ) : null}

          <form
            className="mt-8 w-full"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="border-border bg-background focus-within:border-primary border transition-colors">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder="A polished launch site with a full-bleed hero, product gallery, verified specs, and a preorder CTA…"
                rows={4}
                maxLength={2000}
                disabled={!canEdit || create.isPending}
                aria-label="Describe the site to build"
                className="placeholder:text-muted-foreground min-h-[120px] w-full resize-none bg-transparent px-4 py-4 text-left text-[15px] leading-relaxed outline-none disabled:opacity-60"
              />
              <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setShowOptions((v) => !v)}
                  className="text-muted-foreground hover:text-foreground font-mono text-[11px] tracking-[0.1em] uppercase transition-colors"
                >
                  {showOptions ? "Hide options" : "Options"}
                </button>
                <Button
                  type="submit"
                  disabled={!canEdit || create.isPending || !prompt.trim()}
                  className="rounded-none px-5 font-mono text-[12px] tracking-[0.1em] uppercase"
                >
                  {create.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  {create.isPending ? "Building…" : "Build"}
                </Button>
              </div>
            </div>

            {showOptions ? (
              <div className="border-border bg-background/80 mt-3 border px-4 py-3 text-left">
                <label
                  htmlFor="site-project"
                  className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase"
                >
                  Product context
                </label>
                <select
                  id="site-project"
                  className="border-input bg-background mt-1.5 h-9 w-full border px-3 text-sm outline-none"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  disabled={!canEdit}
                >
                  <option value="">No product — generic site</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </form>

          <p className="text-muted-foreground mt-4 font-mono text-[11px]">
            ⌘/Ctrl + Enter to build
          </p>
        </div>
      </section>

      {/* Library */}
      {sites.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading sites">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="bg-card border-border h-64 animate-pulse border" />
          ))}
        </div>
      ) : hasSites ? (
        <div>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h3 className="font-mono text-[12px] tracking-[0.14em] uppercase">
              Your sites
              <span className="text-muted-foreground ml-2 font-normal">
                {sites.data!.length}
              </span>
            </h3>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sites.data!.map((site) => (
              <article
                key={site.id}
                className="border-border bg-card group overflow-hidden border transition-colors hover:border-primary/40"
              >
                <Link
                  href={`/w/${workspaceSlug}/sites/${site.slug}/editor`}
                  className="block focus-visible:outline-none"
                >
                  <div className="bg-muted relative aspect-[16/9] overflow-hidden border-b">
                    {site.previewUrl ? (
                      <iframe
                        src={site.previewUrl}
                        title=""
                        tabIndex={-1}
                        loading="lazy"
                        className="pointer-events-none h-[200%] w-[200%] origin-top-left scale-50 border-0"
                        sandbox="allow-scripts allow-same-origin"
                      />
                    ) : (
                      <div className="bg-primary relative flex h-full items-center justify-center overflow-hidden">
                        <div
                          aria-hidden
                          className="absolute inset-0 opacity-30"
                          style={{
                            backgroundImage:
                              "radial-gradient(circle, #faf9f5 0.7px, transparent 0.8px)",
                            backgroundSize: "6px 6px",
                          }}
                        />
                        <LayoutTemplate
                          className="relative z-10 size-8 text-[#faf9f5]/70"
                          strokeWidth={1.4}
                        />
                      </div>
                    )}
                    <div className="absolute top-2 left-2 flex items-center gap-1.5">
                      <Badge
                        variant={site.status === "PUBLISHED" ? "default" : "secondary"}
                        className="rounded-none"
                      >
                        {site.status === "PUBLISHED" ? "Live" : "Draft"}
                      </Badge>
                      {site.simulated ? (
                        <Badge variant="destructive" className="rounded-none">
                          SIMULATED
                        </Badge>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "bg-background absolute top-2 right-2 flex size-7 items-center justify-center border opacity-0 transition",
                        "group-hover:opacity-100",
                      )}
                    >
                      <ArrowUpRight className="size-3.5" />
                    </span>
                  </div>

                  <div className="space-y-3 p-4">
                    <div>
                      <h2 className="truncate font-mono text-[14px] font-medium tracking-[-0.02em]">
                        {site.name}
                      </h2>
                      <p className="text-muted-foreground mt-0.5 truncate font-mono text-[11px]">
                        {site.publishedUrl ?? site.previewUrl ?? `${site.slug}.foundry.site`}
                      </p>
                    </div>

                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tracking-wide uppercase">
                      <span className="flex items-center gap-1">
                        <Globe className="size-3" />
                        {site.project?.name ?? "Standalone"}
                      </span>
                      <span className="flex items-center gap-1">
                        <ShoppingBag className="size-3" />
                        {site._count.listings} listing
                        {site._count.listings === 1 ? "" : "s"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock3 className="size-3" />
                        {updatedLabel(site.updatedAt)}
                      </span>
                    </div>

                    <div className="border-border flex items-center justify-between border-t pt-3">
                      <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                        <Store className="size-3.5 shrink-0" />
                        <span className="truncate">
                          {site.checkout?.shopDomain ?? "Commerce not connected"}
                        </span>
                      </span>
                      <span className="text-primary font-mono text-[11px] tracking-[0.08em] uppercase">
                        Open
                      </span>
                    </div>
                  </div>
                </Link>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
