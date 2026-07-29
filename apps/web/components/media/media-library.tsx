"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Film, ImageIcon, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { PRODUCT_MEDIA_ROLES, type ProductMediaRole } from "@foundry/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DotMatrixLoader } from "@/components/dot-matrix-loader";
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

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function rolesFromJobInput(input: unknown): ProductMediaRole[] {
  if (!input || typeof input !== "object") return [];
  const roles = (input as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) return [];
  return roles.filter((role): role is ProductMediaRole =>
    PRODUCT_MEDIA_ROLES.includes(role as ProductMediaRole),
  );
}

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
  const jobs = trpc.media.jobs.useQuery({ projectId }, { refetchInterval: 5_000 });

  const [prompt, setPrompt] = useState("");
  const [roles, setRoles] = useState<ProductMediaRole[]>(DEFAULT_ROLES);
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECT_RATIOS)[number][0]>("16:9");
  const [seedMediaId, setSeedMediaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  /** Roles/slots shown as skeleton tiles while a job is in flight. */
  const [pendingSlots, setPendingSlots] = useState<
    { kind: "STILL" | "VIDEO"; role: ProductMediaRole }[]
  >([]);

  // Resume a job that was already running when the page loaded / remounted.
  useEffect(() => {
    if (activeJobId || !jobs.data?.length) return;
    const open = jobs.data.find((j) => j.status === "PENDING" || j.status === "RUNNING");
    if (!open) return;
    setActiveJobId(open.id);
    if (open.type === "GENERATE_VIDEO") {
      setPendingSlots([{ kind: "VIDEO", role: "HERO" }]);
    } else {
      const fromInput = rolesFromJobInput(open.input);
      setPendingSlots(
        (fromInput.length ? fromInput : DEFAULT_ROLES).map((role) => ({
          kind: "STILL" as const,
          role,
        })),
      );
    }
  }, [jobs.data, activeJobId]);

  const job = trpc.media.job.useQuery(
    { jobId: activeJobId ?? "" },
    {
      enabled: !!activeJobId,
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        return s === "PENDING" || s === "RUNNING" ? 1500 : false;
      },
    },
  );

  const refresh = () =>
    Promise.all([
      utils.media.list.invalidate({ projectId }),
      utils.media.jobs.invalidate({ projectId }),
    ]);
  const onError = (mutationError: { message: string }) => setError(mutationError.message);

  const jobStatus = job.data?.status;
  const jobRunning = jobStatus === "PENDING" || jobStatus === "RUNNING";

  // While generating, keep the gallery fresh so stills appear as the worker finishes them.
  useEffect(() => {
    if (!activeJobId || !jobRunning) return;
    const id = window.setInterval(() => {
      void utils.media.list.invalidate({ projectId });
    }, 2500);
    return () => window.clearInterval(id);
  }, [activeJobId, jobRunning, projectId, utils.media.list]);

  useEffect(() => {
    if (!activeJobId || !jobRunning) {
      setElapsedSec(0);
      return;
    }
    const started = job.data?.startedAt
      ? new Date(job.data.startedAt).getTime()
      : job.data?.createdAt
        ? new Date(job.data.createdAt).getTime()
        : Date.now();
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [activeJobId, jobRunning, job.data?.startedAt, job.data?.createdAt]);

  useEffect(() => {
    if (!activeJobId || jobStatus === "PENDING" || jobStatus === "RUNNING") return;
    if (jobStatus === "FAILED" || jobStatus === "CANCELLED") {
      setError(job.data?.error ?? "Generation failed");
      setNotice(null);
    } else if (jobStatus === "SUCCEEDED") {
      setError(null);
      setNotice(
        job.data?.error ? `Finished with issues: ${job.data.error}` : "Generation complete.",
      );
    }
    setActiveJobId(null);
    setPendingSlots([]);
    void refresh();
    // Only the job outcome should drive this cleanup.
  }, [activeJobId, jobStatus, job.data?.error]);

  const onQueued = (
    result: { jobId: string },
    slots: { kind: "STILL" | "VIDEO"; role: ProductMediaRole }[],
  ) => {
    setError(null);
    setNotice(null);
    setPendingSlots(slots);
    setActiveJobId(result.jobId);
    void utils.media.jobs.invalidate({ projectId });
  };

  const generateStills = trpc.media.generateStills.useMutation({
    onSuccess: (result) =>
      onQueued(
        result,
        roles.map((role) => ({ kind: "STILL" as const, role })),
      ),
    onError,
  });
  const generateVideo = trpc.media.generateVideo.useMutation({
    onSuccess: (result) => onQueued(result, [{ kind: "VIDEO", role: "HERO" }]),
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
  const queuing = generateStills.isPending || generateVideo.isPending;
  const busy = queuing || !!activeJobId;
  const stillsRunning =
    generateStills.isPending || (!!activeJobId && job.data?.type === "GENERATE_STILLS");
  const videoRunning =
    generateVideo.isPending || (!!activeJobId && job.data?.type === "GENERATE_VIDEO");

  const statusLabel = queuing
    ? "Starting generation…"
    : jobStatus === "RUNNING"
      ? stillsRunning
        ? "Rendering product stills…"
        : "Generating product video…"
      : jobStatus === "PENDING"
        ? "Queued — waiting for worker…"
        : "Generating…";

  function toggleRole(role: ProductMediaRole) {
    if (busy) return;
    setRoles((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
    );
  }

  return (
    <div className="flex flex-col gap-4" aria-busy={busy}>
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
        <Card className={cn("gap-3 p-4", busy && "border-primary/40")}>
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5" />
            <p className="text-sm font-medium">Generate product media</p>
            {busy ? (
              <Badge variant="default" className="ml-auto gap-1.5">
                <Loader2 className="size-3 animate-spin" />
                In progress
              </Badge>
            ) : null}
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
            disabled={busy}
          />

          <div className="flex flex-wrap gap-1.5">
            {PRODUCT_MEDIA_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => toggleRole(role)}
                disabled={busy}
                className={cn(
                  "border-border border px-2 py-1 font-mono text-[10px] tracking-[0.06em] uppercase transition disabled:opacity-50",
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
              disabled={busy}
              className="border-border bg-background h-8 border px-2 text-xs disabled:opacity-50"
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
              {stillsRunning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ImageIcon className="size-3.5" />
              )}
              {stillsRunning
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
              {videoRunning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Film className="size-3.5" />
              )}
              {videoRunning ? "Filming…" : "Generate 6s video"}
            </Button>
            {stills.length > 0 && status.data?.videoConfigured ? (
              <select
                value={seedMediaId ?? ""}
                onChange={(event) => setSeedMediaId(event.target.value || null)}
                aria-label="Video first frame"
                disabled={busy}
                className="border-border bg-background h-8 border px-2 text-xs disabled:opacity-50"
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

          {busy ? (
            <div
              role="status"
              aria-live="polite"
              className="border-border bg-muted/40 flex flex-col gap-3 border p-3"
            >
              <div className="flex items-center gap-2">
                <Loader2 className="text-primary size-4 shrink-0 animate-spin" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{statusLabel}</p>
                  <p className="text-muted-foreground font-mono text-[11px]">
                    {jobStatus === "PENDING"
                      ? "Job is queued on the media worker"
                      : "Worker is calling the image/video provider"}
                    {elapsedSec > 0 ? ` · ${formatElapsed(elapsedSec)}` : null}
                    {pendingSlots.length > 1
                      ? ` · ${pendingSlots.length} assets`
                      : pendingSlots.length === 1
                        ? " · 1 asset"
                        : null}
                  </p>
                </div>
              </div>
              <div className="bg-muted h-1.5 w-full overflow-hidden">
                <div
                  className={cn(
                    "bg-primary h-full transition-[width] duration-700",
                    jobStatus === "PENDING" || queuing
                      ? "w-1/5 animate-pulse"
                      : "w-3/5 animate-pulse",
                  )}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
          {notice && !busy ? <p className="text-muted-foreground text-xs">{notice}</p> : null}
        </Card>
      ) : null}

      {list.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i} className="gap-2 overflow-hidden p-0">
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="flex flex-col gap-2 p-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-40" />
              </div>
            </Card>
          ))}
        </div>
      ) : assets.length === 0 && pendingSlots.length === 0 ? (
        <EmptyState title="No product media yet">
          Generate renders here, then attach the approved ones to a storefront site.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pendingSlots.map((slot) => (
            <Card
              key={`pending-${slot.kind}-${slot.role}`}
              className="border-primary/30 gap-2 overflow-hidden p-0"
            >
              <div className="bg-muted relative aspect-video w-full overflow-hidden">
                <DotMatrixLoader
                  className="absolute inset-0"
                  label={slot.kind === "VIDEO" ? "Filming" : "Rendering"}
                  gap={14}
                />
              </div>
              <div className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{ROLE_LABEL[slot.role]}</Badge>
                  <Badge variant="outline">{slot.kind}</Badge>
                  <Badge variant="secondary" className="gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    Generating
                  </Badge>
                </div>
                <p className="text-muted-foreground font-mono text-[10px]">
                  {statusLabel}
                  {elapsedSec > 0 ? ` · ${formatElapsed(elapsedSec)}` : ""}
                </p>
              </div>
            </Card>
          ))}

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
                          busy ||
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
                        disabled={busy || setApproval.isPending || asset.approval === "REJECTED"}
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
                      disabled={busy || remove.isPending}
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
