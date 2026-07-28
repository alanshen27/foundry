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
  Plus,
  ShoppingBag,
  Sparkles,
  Store,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

type WorkspaceProject = { id: string; name: string; slug: string };

function updatedLabel(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round((date.getTime() - Date.now()) / 86_400_000),
    "day",
  );
}

/**
 * Card-based workspace site library. Opening a card moves into the native
 * preview/code/chat editor instead of turning this overview into an editor.
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

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.site.create.useMutation({
    onSuccess: async (site) => {
      await utils.site.list.invalidate({ workspaceId });
      setName("");
      setPrompt("");
      setError(null);
      router.push(`/w/${workspaceSlug}/sites/${site.slug}/editor`);
    },
    onError: (nextError) => setError(nextError.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-muted-foreground">
            {sites.data?.length ?? 0} site{sites.data?.length === 1 ? "" : "s"}
          </span>
          {builderStatus.data && !builderStatus.data.configured ? (
            <Badge variant="destructive">SIMULATED builder</Badge>
          ) : (
            <Badge variant="secondary">v0 connected</Badge>
          )}
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => setShowCreate((current) => !current)}>
            <Plus />
            New site
          </Button>
        ) : null}
      </div>

      {builderStatus.data && !builderStatus.data.configured ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-4 py-3 text-[13px]">
          <span className="font-medium">SIMULATED mode.</span> Add V0_API_KEY to generate previews,
          source code, and persistent builder conversations.
        </div>
      ) : null}

      {error ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-4 py-3 text-[13px]">
          {error}
        </div>
      ) : null}

      {showCreate && canEdit ? (
        <form
          className="bg-card space-y-4 rounded-2xl border p-5 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({
              workspaceId,
              name,
              prompt,
              projectId: projectId || undefined,
            });
          }}
        >
          <div>
            <h2 className="text-sm font-semibold">Create with Foundry</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Start from a prompt, then refine the page beside its live preview and source code.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="site-name">Site name</Label>
              <Input
                id="site-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Palm Rover store"
                maxLength={80}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-project">Product context</Label>
              <select
                id="site-project"
                className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">No product — generic site</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-prompt">What should we build?</Label>
            <Textarea
              id="site-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="A polished launch site with a full-bleed hero, product gallery, verified specifications, and preorder call to action."
              rows={4}
              maxLength={2000}
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim() || !prompt.trim()}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Generate site
            </Button>
          </div>
        </form>
      ) : null}

      {sites.isLoading ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading sites">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="bg-card h-72 animate-pulse rounded-2xl border" />
          ))}
        </div>
      ) : sites.data?.length ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {sites.data.map((site) => (
            <article
              key={site.id}
              className="bg-card group overflow-hidden rounded-2xl border shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
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
                    <div className="from-primary/10 via-muted to-background flex h-full items-center justify-center bg-gradient-to-br">
                      <LayoutTemplate
                        className="text-muted-foreground/60 size-9"
                        strokeWidth={1.4}
                      />
                    </div>
                  )}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5">
                    <Badge variant={site.status === "PUBLISHED" ? "default" : "secondary"}>
                      {site.status === "PUBLISHED" ? "Live" : "Draft"}
                    </Badge>
                    {site.simulated ? <Badge variant="destructive">SIMULATED</Badge> : null}
                  </div>
                  <span className="bg-background/90 absolute top-3 right-3 flex size-8 items-center justify-center rounded-full border opacity-0 shadow-sm transition group-hover:opacity-100">
                    <ArrowUpRight className="size-4" />
                  </span>
                </div>

                <div className="space-y-3 p-4">
                  <div>
                    <h2 className="truncate text-[15px] font-semibold">{site.name}</h2>
                    <p className="text-muted-foreground mt-0.5 truncate text-xs">
                      {site.publishedUrl ?? site.previewUrl ?? `${site.slug}.foundry.site`}
                    </p>
                  </div>

                  <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                    <span className="flex items-center gap-1">
                      <Globe className="size-3" />
                      {site.project?.name ?? "Standalone"}
                    </span>
                    <span className="flex items-center gap-1">
                      <ShoppingBag className="size-3" />
                      {site._count.listings} listing{site._count.listings === 1 ? "" : "s"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock3 className="size-3" />
                      Updated {updatedLabel(site.updatedAt)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between border-t pt-3">
                    <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                      <Store className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {site.checkout?.shopDomain ?? "Commerce not connected"}
                      </span>
                    </span>
                    <span className="text-primary text-xs font-medium">Open editor</span>
                  </div>
                </div>
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="bg-card flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-20 text-center">
          <span className="bg-muted text-muted-foreground mb-4 flex size-12 items-center justify-center rounded-2xl">
            <Globe className="size-5" strokeWidth={1.6} />
          </span>
          <p className="text-sm font-medium">Your sites will live here</p>
          <p className="text-muted-foreground mt-1 max-w-md text-[13px]">
            Generate a launch page, then work in a focused preview, code, chat, and commerce
            workspace.
          </p>
          {canEdit ? (
            <Button className="mt-4" size="sm" onClick={() => setShowCreate(true)}>
              <Plus />
              Create your first site
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
