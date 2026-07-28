"use client";

import { useState } from "react";
import { ExternalLink, Globe, Loader2, Rocket, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

type WorkspaceProject = { id: string; name: string; slug: string };

/**
 * Workspace storefront sites. Generation, preview hosting, and deployment
 * are handled by the site builder (v0) — this panel only drives it and
 * shows the preview it returns.
 */
export function SitesPanel({
  workspaceId,
  projects,
  canEdit,
  canPublish,
}: {
  workspaceId: string;
  projects: WorkspaceProject[];
  canEdit: boolean;
  canPublish: boolean;
}) {
  const utils = trpc.useUtils();
  const builderStatus = trpc.site.builderStatus.useQuery();
  const sites = trpc.site.list.useQuery({ workspaceId });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [revisePrompt, setRevisePrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    await utils.site.list.invalidate({ workspaceId });
  };

  const create = trpc.site.create.useMutation({
    onSuccess: async (site) => {
      setName("");
      setPrompt("");
      setSelectedId(site.id);
      setError(null);
      await refresh();
    },
    onError: (e) => setError(e.message),
  });

  const revise = trpc.site.revise.useMutation({
    onSuccess: async () => {
      setRevisePrompt("");
      setError(null);
      await refresh();
    },
    onError: (e) => setError(e.message),
  });

  const publish = trpc.site.publish.useMutation({
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (e) => setError(e.message),
  });

  const selected = sites.data?.find((s) => s.id === selectedId) ?? null;
  const busy = create.isPending || revise.isPending || publish.isPending;

  return (
    <div className="space-y-6">
      {builderStatus.data && !builderStatus.data.configured ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-[13px]">
          <span className="font-medium">SIMULATED mode.</span> V0_API_KEY is not set, so no site is
          actually generated and publishing is disabled.
        </div>
      ) : null}

      {error ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-[13px]">
          {error}
        </div>
      ) : null}

      {canEdit ? (
        <form
          className="bg-card space-y-3 rounded-xl border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({
              workspaceId,
              name,
              prompt,
              projectId: projectId || undefined,
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="site-name">Site name</Label>
              <Input
                id="site-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Palm Rover store"
                maxLength={80}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-project">Product (optional)</Label>
              <select
                id="site-project"
                className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">No product — generic page</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-prompt">Describe the page</Label>
            <Textarea
              id="site-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A dark, technical landing page with a hero render, spec table, and a preorder call to action."
              rows={3}
              maxLength={2000}
              required
            />
            <p className="text-muted-foreground text-[12px]">
              Linking a product sends its real requirements, components, and verification state to
              the builder so the copy cannot invent specs.
            </p>
          </div>
          <Button type="submit" disabled={busy || !name.trim() || !prompt.trim()}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Generate site
          </Button>
        </form>
      ) : null}

      {sites.isLoading ? (
        <p className="text-muted-foreground text-[13px]">Loading sites…</p>
      ) : sites.data?.length ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <ul className="space-y-1.5">
            {sites.data.map((site) => (
              <li key={site.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(site.id)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    site.id === selectedId ? "border-primary bg-muted" : "hover:bg-muted/50"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{site.name}</span>
                    {site.simulated ? (
                      <Badge variant="destructive">SIMULATED</Badge>
                    ) : (
                      <Badge variant={site.status === "PUBLISHED" ? "default" : "secondary"}>
                        {site.status}
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block truncate text-[12px]">
                    {site.project?.name ?? "No product linked"}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {selected.publishedUrl ? (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={selected.publishedUrl} target="_blank" rel="noreferrer" />}
                  >
                    <Globe />
                    Live site
                  </Button>
                ) : null}
                {selected.builderUrl ? (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={selected.builderUrl} target="_blank" rel="noreferrer" />}
                  >
                    <ExternalLink />
                    Open in v0
                  </Button>
                ) : null}
                {canPublish && !selected.simulated ? (
                  <Button
                    size="sm"
                    disabled={busy || !selected.builderVersionId}
                    onClick={() => publish.mutate({ id: selected.id })}
                  >
                    {publish.isPending ? <Loader2 className="animate-spin" /> : <Rocket />}
                    {selected.status === "PUBLISHED" ? "Republish" : "Publish"}
                  </Button>
                ) : null}
              </div>

              {selected.previewUrl ? (
                <iframe
                  key={selected.previewUrl}
                  src={selected.previewUrl}
                  title={`${selected.name} preview`}
                  className="bg-background h-[520px] w-full rounded-xl border"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              ) : (
                <div className="text-muted-foreground bg-card flex h-[520px] items-center justify-center rounded-xl border border-dashed text-[13px]">
                  {selected.simulated
                    ? "SIMULATED site — nothing was generated."
                    : "No preview yet."}
                </div>
              )}

              {canEdit ? (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    revise.mutate({ id: selected.id, prompt: revisePrompt });
                  }}
                >
                  <Input
                    value={revisePrompt}
                    onChange={(e) => setRevisePrompt(e.target.value)}
                    placeholder="Make the hero darker and add a spec comparison table…"
                    maxLength={2000}
                  />
                  <Button type="submit" variant="secondary" disabled={busy || !revisePrompt.trim()}>
                    {revise.isPending ? <Loader2 className="animate-spin" /> : null}
                    Revise
                  </Button>
                </form>
              ) : null}
            </div>
          ) : (
            <div className="text-muted-foreground bg-card flex items-center justify-center rounded-xl border border-dashed text-[13px]">
              Select a site to preview it.
            </div>
          )}
        </div>
      ) : (
        <div className="bg-card flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
          <span className="bg-muted text-muted-foreground mb-3 flex size-10 items-center justify-center rounded-lg">
            <Globe className="size-4" strokeWidth={1.75} />
          </span>
          <p className="text-[13px] font-medium">No sites yet</p>
          <p className="text-muted-foreground mt-1 max-w-sm text-[13px]">
            Describe a landing page above and the builder will generate, host, and preview it.
          </p>
        </div>
      )}
    </div>
  );
}
