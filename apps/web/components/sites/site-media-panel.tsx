"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ImageOff, Link2, Loader2, Unlink } from "lucide-react";
import { SITE_MEDIA_SLOTS, SITE_MEDIA_SLOT_LIMITS, type SiteMediaSlot } from "@foundry/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

const SLOT_LABEL: Record<SiteMediaSlot, string> = {
  HERO: "Hero",
  GALLERY: "Gallery",
  VIDEO_PRIMARY: "Primary video",
  SOCIAL: "Social / OG",
};

const SLOT_HINT: Record<SiteMediaSlot, string> = {
  HERO: "Single above-the-fold image.",
  GALLERY: "Ordered product gallery.",
  VIDEO_PRIMARY: "One product video with controls.",
  SOCIAL: "Used for og:image and twitter:image only.",
};

/**
 * Attaches approved product media to a site's layout slots.
 *
 * The builder receives these assets (and their order) as part of the site
 * system prompt on the next revision, so attaching alone does not change the
 * live page — the user still regenerates.
 */
export function SiteMediaPanel({
  siteId,
  projectId,
  canEdit,
}: {
  siteId: string;
  projectId: string | null;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const attachments = trpc.media.siteMedia.useQuery({ siteId });
  const library = trpc.media.list.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  const [slot, setSlot] = useState<SiteMediaSlot>("HERO");
  const [mediaId, setMediaId] = useState("");
  const [altText, setAltText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => utils.media.siteMedia.invalidate({ siteId });
  const onError = (mutationError: { message: string }) => setError(mutationError.message);

  const attach = trpc.media.attach.useMutation({
    onSuccess: async () => {
      setError(null);
      setMediaId("");
      setAltText("");
      await refresh();
    },
    onError,
  });
  const detach = trpc.media.detach.useMutation({
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError,
  });
  const reorder = trpc.media.reorder.useMutation({
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError,
  });

  if (!projectId) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-sm">
        Link this site to a project to use its product media.
      </div>
    );
  }

  const items = attachments.data ?? [];
  const approved = (library.data ?? []).filter(
    (asset) => asset.approval === "APPROVED_FOR_MARKETING" && !asset.simulated,
  );
  const attachedIds = new Set(items.map((item) => item.mediaId));
  const available = approved.filter((asset) => !attachedIds.has(asset.id));

  function move(slotKey: SiteMediaSlot, attachmentId: string, direction: -1 | 1) {
    const ordered = items.filter((item) => item.slot === slotKey).map((item) => item.id);
    const index = ordered.indexOf(attachmentId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= ordered.length) return;
    [ordered[index], ordered[next]] = [ordered[next]!, ordered[index]!];
    reorder.mutate({ siteId, slot: slotKey, attachmentIds: ordered });
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {canEdit ? (
          <Card className="gap-3 p-4">
            <p className="text-sm font-medium">Attach approved media</p>
            <p className="text-muted-foreground text-xs">
              Only assets approved for marketing in Launch appear here. Regenerate the site after
              attaching so the builder embeds them.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={slot}
                onChange={(event) => setSlot(event.target.value as SiteMediaSlot)}
                aria-label="Slot"
                className="border-border bg-background h-8 border px-2 text-xs"
              >
                {SITE_MEDIA_SLOTS.map((value) => (
                  <option key={value} value={value}>
                    {SLOT_LABEL[value]} (max {SITE_MEDIA_SLOT_LIMITS[value]})
                  </option>
                ))}
              </select>
              <select
                value={mediaId}
                onChange={(event) => setMediaId(event.target.value)}
                aria-label="Media asset"
                className="border-border bg-background h-8 min-w-48 border px-2 text-xs"
              >
                <option value="">Select an asset…</option>
                {available.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.role} · {asset.kind} · {asset.id.slice(-6)}
                  </option>
                ))}
              </select>
              <Input
                value={altText}
                onChange={(event) => setAltText(event.target.value)}
                placeholder="Alt text (recommended)"
                className="h-8 w-56 text-xs"
                aria-label="Alt text"
              />
              <Button
                size="sm"
                disabled={!mediaId || attach.isPending}
                onClick={() =>
                  attach.mutate({
                    siteId,
                    mediaId,
                    slot,
                    altText: altText.trim() || undefined,
                  })
                }
              >
                {attach.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Link2 className="size-3.5" />
                )}
                Attach
              </Button>
            </div>
            {approved.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <ImageOff className="size-3.5" />
                No approved media yet — generate and approve renders in the project&apos;s Launch
                stage.
              </p>
            ) : null}
            {error ? <p className="text-destructive text-xs">{error}</p> : null}
          </Card>
        ) : null}

        {SITE_MEDIA_SLOTS.map((slotKey) => {
          const slotItems = items.filter((item) => item.slot === slotKey);
          return (
            <Card key={slotKey} className="gap-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{SLOT_LABEL[slotKey]}</p>
                <Badge variant="outline">
                  {slotItems.length}/{SITE_MEDIA_SLOT_LIMITS[slotKey]}
                </Badge>
              </div>
              <p className="text-muted-foreground text-xs">{SLOT_HINT[slotKey]}</p>
              {slotItems.length === 0 ? (
                <p className="text-muted-foreground text-xs">Empty.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {slotItems.map((item, index) => (
                    <li key={item.id} className="flex items-center gap-3">
                      <div className="bg-muted size-16 shrink-0 overflow-hidden">
                        {item.media.kind === "VIDEO" ? (
                          <video
                            src={item.media.url}
                            poster={item.media.posterUrl ?? undefined}
                            muted
                            playsInline
                            className="size-full object-cover"
                          />
                        ) : (
                          // Not next/image: authenticated proxy URLs.
                          <img
                            src={item.media.url}
                            alt={item.altText ?? ""}
                            className="size-full object-cover"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs">{item.altText ?? "No alt text"}</p>
                        <p className="text-muted-foreground truncate font-mono text-[10px]">
                          {item.media.role} · {item.media.generator ?? "unknown"}
                        </p>
                      </div>
                      {canEdit ? (
                        <div className="flex items-center gap-1">
                          {slotItems.length > 1 ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Move up"
                                disabled={index === 0 || reorder.isPending}
                                onClick={() => move(slotKey, item.id, -1)}
                              >
                                <ArrowUp className="size-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Move down"
                                disabled={index === slotItems.length - 1 || reorder.isPending}
                                onClick={() => move(slotKey, item.id, 1)}
                              >
                                <ArrowDown className="size-3.5" />
                              </Button>
                            </>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Detach"
                            disabled={detach.isPending}
                            onClick={() => detach.mutate({ attachmentId: item.id })}
                          >
                            <Unlink className="size-3.5" />
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
