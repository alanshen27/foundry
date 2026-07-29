"use client";

import { useState } from "react";
import { AlertTriangle, Check, Film, ImageIcon, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { PRODUCT_MEDIA_ROLES, type ProductMediaRole } from "@foundry/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const ASPECT_RATIOS = [
  ["16:9", "Wide 16:9"],
  ["4:3", "Classic 4:3"],
  ["1:1", "Square 1:1"],
  ["9:16", "Vertical 9:16"],
] as const;

const ROLE_LABEL: Record<ProductMediaRole, string> = {
  HERO: "Hero",
  GALLERY: "Gallery",
  DETAIL: "Detail",
  LIFESTYLE: "Lifestyle",
  SOCIAL: "Social",
  EXPLODED: "Exploded",
  OTHER: "Other",
};

const DEFAULT_ROLES: ProductMediaRole[] = ["HERO", "GALLERY", "DETAIL"];

/**
 * Marketing media library for one project: generate product renders and a short
 * product video, then approve them for storefront use.
 *
 * Approval is a separate, admin-gated step because a render is marketing, not
 * engineering evidence — and SIMULATED assets can never be approved.
 */
export function MediaLibrary({
  projectId,
  canEdit,
  canApprove,
}: {
  projectId: string;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const utils = trpc.useUtils();
  const status = trpc.media.status.useQuery();
  const list = trpc.media.list.useQuery({ projectId });

  const [prompt, setPrompt] = useState("");
  const [roles, setRoles] = useState<ProductMediaRole[]>(DEFAULT_ROLES);
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECT_RATIOS)[number][0]>("16:9");
  const [seedMediaId, setSeedMediaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => utils.media.list.invalidate({ projectId });
  const onError = (mutationError: { message: string }) => setError(mutationError.message);

  const generateStills = trpc.media.generateStills.useMutation({
    onSuccess: async (result) => {
      setError(null);
      setNotice(
        result.partialFailures.length
          ? `Generated ${result.media.length}; ${result.partialFailures.length} failed.`
          : null,
      );
      await refresh();
    },
    onError,
  });
  const generateVideo = trpc.media.generateVideo.useMutation({
    onSuccess: async () => {
      setError(null);
      setNotice(null);
      await refresh();
    },
    onError,
  });
  const setApproval = trpc.media.setApproval.useMutation({
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError,
  });
  const remove = trpc.media.remove.useMutation({
    onSuccess: async () => {
      setError(null);
      if (seedMediaId) setSeedMediaId(null);
      await refresh();
    },
    onError,
  });

  const assets = list.data ?? [];
  const stills = assets.filter((asset) => asset.kind === "STILL");
  const simulatedMode = status.data ? !status.data.imageConfigured : false;
  const busy = generateStills.isPending || generateVideo.isPending;

  function toggleRole(role: ProductMediaRole) {
    setRoles((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {simulatedMode ? (
        <div
          role="status"
          className="border-border flex items-start gap-2 border border-dashed p-3 font-mono text-[11px] leading-relaxed"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p className="font-medium tracking-[0.08em] uppercase">Simulated media mode</p>
            <p className="text-muted-foreground">
              No image provider is configured, so generated assets are labeled placeholders. They
              cannot be approved for marketing or attached to a site. Set OPENAI_API_KEY for real
              renders.
            </p>
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <Card className="gap-3 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5" />
            <p className="text-sm font-medium">Generate product media</p>
          </div>
          <p className="text-muted-foreground text-xs">
            Prompts are grounded in this project&apos;s requirements and components, so renders
            depict the product you designed rather than stock imagery.
          </p>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            placeholder="Art direction: materials, colorway, surface finish, backdrop, mood…"
            aria-label="Media art direction"
          />

          <div className="flex flex-wrap gap-1.5">
            {PRODUCT_MEDIA_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => toggleRole(role)}
                className={cn(
                  "border-border border px-2 py-1 font-mono text-[10px] tracking-[0.06em] uppercase transition",
                  roles.includes(role)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={roles.includes(role)}
              >
                {ROLE_LABEL[role]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={aspectRatio}
              onChange={(event) =>
                setAspectRatio(event.target.value as (typeof ASPECT_RATIOS)[number][0])
              }
              aria-label="Aspect ratio"
              className="border-border bg-background h-8 border px-2 text-xs"
            >
              {ASPECT_RATIOS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={busy || prompt.trim().length < 10 || roles.length === 0}
              onClick={() =>
                generateStills.mutate({
                  projectId,
                  prompt: prompt.trim(),
                  roles,
                  aspectRatio,
                })
              }
            >
              {generateStills.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ImageIcon className="size-3.5" />
              )}
              {generateStills.isPending
                ? "Rendering…"
                : `Generate ${roles.length} render${roles.length === 1 ? "" : "s"}`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || prompt.trim().length < 10 || !status.data?.videoConfigured}
              title={
                status.data?.videoConfigured
                  ? undefined
                  : "Video generation is not configured (MEDIA_VIDEO_MODEL)"
              }
              onClick={() =>
                generateVideo.mutate({
                  projectId,
                  prompt: prompt.trim(),
                  durationSec: 6,
                  seedMediaId,
                })
              }
            >
              {generateVideo.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Film className="size-3.5" />
              )}
              {generateVideo.isPending ? "Filming…" : "Generate 6s video"}
            </Button>
            {stills.length > 0 && status.data?.videoConfigured ? (
              <select
                value={seedMediaId ?? ""}
                onChange={(event) => setSeedMediaId(event.target.value || null)}
                aria-label="Video first frame"
                className="border-border bg-background h-8 border px-2 text-xs"
              >
                <option value="">Video first frame: none</option>
                {stills.map((still) => (
                  <option key={still.id} value={still.id}>
                    First frame: {ROLE_LABEL[still.role]} · {still.id.slice(-6)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          {notice ? <p className="text-muted-foreground text-xs">{notice}</p> : null}
        </Card>
      ) : null}

      {list.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading media…</p>
      ) : assets.length === 0 ? (
        <EmptyState title="No product media yet">
          Generate renders here, then attach the approved ones to a storefront site.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((asset) => (
            <Card key={asset.id} className="gap-2 overflow-hidden p-0">
              <div className="bg-muted aspect-video w-full overflow-hidden">
                {asset.kind === "VIDEO" ? (
                  <video
                    src={asset.url}
                    poster={asset.posterUrl ?? undefined}
                    controls
                    muted
                    playsInline
                    className="size-full object-cover"
                  />
                ) : (
                  // Not next/image: authenticated proxy URLs, not optimizable assets.
                  <img
                    src={asset.url}
                    alt={asset.prompt ?? ""}
                    className="size-full object-cover"
                  />
                )}
              </div>
              <div className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{ROLE_LABEL[asset.role]}</Badge>
                  <Badge variant="outline">{asset.kind}</Badge>
                  {asset.simulated ? <Badge variant="destructive">Simulated</Badge> : null}
                  <Badge
                    variant={
                      asset.approval === "APPROVED_FOR_MARKETING"
                        ? "default"
                        : asset.approval === "REJECTED"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {asset.approval === "APPROVED_FOR_MARKETING" ? "Approved" : asset.approval}
                  </Badge>
                </div>
                <p className="text-muted-foreground truncate font-mono text-[10px]">
                  {asset.generator ?? "unknown"}
                  {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {canApprove ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          setApproval.isPending ||
                          asset.simulated ||
                          asset.approval === "APPROVED_FOR_MARKETING"
                        }
                        title={
                          asset.simulated
                            ? "Simulated assets cannot be approved for marketing"
                            : undefined
                        }
                        onClick={() =>
                          setApproval.mutate({
                            mediaId: asset.id,
                            approval: "APPROVED_FOR_MARKETING",
                          })
                        }
                      >
                        <Check className="size-3.5" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={setApproval.isPending || asset.approval === "REJECTED"}
                        onClick={() =>
                          setApproval.mutate({ mediaId: asset.id, approval: "REJECTED" })
                        }
                      >
                        <X className="size-3.5" />
                        Reject
                      </Button>
                    </>
                  ) : null}
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ mediaId: asset.id })}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
