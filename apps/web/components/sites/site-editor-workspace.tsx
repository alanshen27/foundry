"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createOffBroadcastPort,
  createSupabaseBroadcastPort,
  siteBroadcastChannel,
  sitePresenceChannel,
  type BroadcastPort,
} from "@foundry/realtime";
import {
  AlertTriangle,
  ArrowLeft,
  Code2,
  ExternalLink,
  Globe,
  Images,
  Loader2,
  Monitor,
  PanelRight,
  Pencil,
  Rocket,
  Send,
  ShoppingBag,
  Smartphone,
  Tablet,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FoundryMarkIcon } from "@/components/foundry-mark";
import { PresenceBar } from "@/components/presence-bar";
import { CommercePanel } from "@/components/sites/commerce-panel";
import { CollaborativeSitePrompt } from "@/components/sites/collaborative-site-prompt";
import { SiteCodeWorkspace } from "@/components/sites/site-code-workspace";
import { SiteMediaPanel } from "@/components/sites/site-media-panel";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type EditorView = "preview" | "code" | "media" | "commerce";
type PreviewSize = "desktop" | "tablet" | "mobile";
type StreamState = {
  status: "started" | "generated" | "completed" | "failed" | "publishing" | "published";
  prompt?: string;
  message?: string;
};

const PREVIEW_WIDTH: Record<PreviewSize, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "390px",
};

const REALTIME_MODE = process.env.NEXT_PUBLIC_REALTIME_MODE ?? "off";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function createSiteBroadcastPort(): BroadcastPort {
  if (REALTIME_MODE === "supabase" && SUPABASE_URL && SUPABASE_ANON_KEY) {
    return createSupabaseBroadcastPort({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  }
  return createOffBroadcastPort();
}

function streamStateOf(payload: unknown): StreamState | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (
    value.status !== "started" &&
    value.status !== "generated" &&
    value.status !== "completed" &&
    value.status !== "failed" &&
    value.status !== "publishing" &&
    value.status !== "published"
  ) {
    return null;
  }
  return {
    status: value.status,
    prompt: typeof value.prompt === "string" ? value.prompt : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
  };
}

export function SiteEditorWorkspace({
  siteId,
  siteName,
  siteSlug,
  workspaceSlug,
  user,
  canEdit,
  canPublish,
  canManageCommerce,
}: {
  siteId: string;
  siteName: string;
  siteSlug: string;
  workspaceSlug: string;
  user: { id: string; name: string; avatarUrl?: string | null };
  canEdit: boolean;
  canPublish: boolean;
  canManageCommerce: boolean;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const site = trpc.site.get.useQuery({ id: siteId });
  const workspace = trpc.site.workspace.useQuery({ id: siteId });
  const collabQuery = trpc.collaboration.siteSession.useQuery(
    { siteId },
    {
      staleTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  );
  const collabSession = collabQuery.data ?? null;
  const [view, setView] = useState<EditorView>("preview");
  const [previewSize, setPreviewSize] = useState<PreviewSize>("desktop");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(siteName);
  const [stream, setStream] = useState<StreamState | null>(null);
  /** Shown immediately on send so status never races ahead of the user bubble. */
  const [optimisticUser, setOptimisticUser] = useState<{
    id: string;
    content: string;
    createdAt: string;
  } | null>(null);
  /** Last known-good preview — don't swap iframe src mid-generation (avoids flash → 404). */
  const [stablePreviewUrl, setStablePreviewUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streamClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    await Promise.all([
      utils.site.get.invalidate({ id: siteId }),
      utils.site.workspace.invalidate({ id: siteId }),
    ]);
  }, [siteId, utils]);

  const revise = trpc.site.revise.useMutation({
    onSuccess: async () => {
      setError(null);
      await refresh();
      setOptimisticUser(null);
    },
    onError: (nextError) => {
      setOptimisticUser(null);
      setStream(null);
      setError(nextError.message);
    },
  });

  const publish = trpc.site.publish.useMutation({
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (nextError) => setError(nextError.message),
  });

  const update = trpc.site.update.useMutation({
    onSuccess: async (updated) => {
      setError(null);
      setRenameOpen(false);
      await refresh();
      if (updated.slug !== siteSlug) {
        router.replace(`/w/${workspaceSlug}/sites/${updated.slug}/editor`);
      } else {
        router.refresh();
      }
    },
    onError: (nextError) => setError(nextError.message),
  });

  const remove = trpc.site.delete.useMutation({
    onSuccess: () => {
      router.push(`/w/${workspaceSlug}/sites`);
      router.refresh();
    },
    onError: (nextError) => setError(nextError.message),
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [workspace.data?.messages, optimisticUser, revise.isPending, stream]);

  useEffect(() => {
    const broadcast = createSiteBroadcastPort();
    const subscription = broadcast.subscribe(siteBroadcastChannel(siteId), (message) => {
      if (message.event !== "site-generation") return;
      const next = streamStateOf(message.payload);
      if (!next) return;
      if (streamClearTimer.current) clearTimeout(streamClearTimer.current);
      setStream(next);

      // Only refresh conversation while generating — hold preview URL until completed.
      if (next.status === "generated") {
        void utils.site.workspace.invalidate({ id: siteId });
      }

      if (next.status === "completed" || next.status === "published" || next.status === "failed") {
        void refresh();
        streamClearTimer.current = setTimeout(() => setStream(null), 2500);
      }
    });
    return () => {
      subscription.leave();
      if (streamClearTimer.current) clearTimeout(streamClearTimer.current);
    };
  }, [refresh, siteId, utils.site.workspace]);

  const currentSite = site.data;
  const currentWorkspace = workspace.data;
  const livePreviewUrl = currentSite?.previewUrl ?? currentWorkspace?.revision.previewUrl ?? null;
  const streamBusy =
    stream?.status === "started" ||
    stream?.status === "generated" ||
    stream?.status === "publishing";
  const busy = revise.isPending || publish.isPending || streamBusy || Boolean(optimisticUser);

  // Commit a new preview URL only when idle — never mid-revise.
  useEffect(() => {
    if (busy) return;
    setStablePreviewUrl(livePreviewUrl);
  }, [busy, livePreviewUrl]);

  useEffect(() => {
    if (!streamBusy && !revise.isPending) return;

    const interval = setInterval(() => {
      void utils.site.workspace.invalidate({ id: siteId });
    }, 1200);

    return () => clearInterval(interval);
  }, [revise.isPending, siteId, streamBusy, utils]);

  function sendPrompt(raw: string) {
    const text = raw.trim();
    if (!text || busy || !canEdit) return;
    setOptimisticUser({
      id: `local-${Date.now()}`,
      content: text,
      createdAt: new Date().toISOString(),
    });
    setPrompt("");
    setError(null);
    setStream({ status: "started", prompt: text });
    setStablePreviewUrl(livePreviewUrl);
    revise.mutate({ id: siteId, prompt: text });
  }

  const serverMessages = (currentWorkspace?.messages ?? []).filter(
    (message) => message.content.trim().length > 0,
  );
  const optimisticAlreadySynced =
    optimisticUser != null &&
    serverMessages.some(
      (message) =>
        message.role === "user" && message.content.trim() === optimisticUser.content.trim(),
    );
  const messages =
    optimisticUser && !optimisticAlreadySynced
      ? [
          ...serverMessages,
          {
            id: optimisticUser.id,
            role: "user" as const,
            content: optimisticUser.content,
            createdAt: optimisticUser.createdAt,
          },
        ]
      : serverMessages;

  const displayPreviewUrl = busy ? stablePreviewUrl : livePreviewUrl;

  const views: { id: EditorView; label: string; icon: typeof Globe }[] = [
    { id: "preview", label: "Preview", icon: Globe },
    { id: "code", label: "Code", icon: Code2 },
    { id: "media", label: "Media", icon: Images },
    { id: "commerce", label: "Commerce", icon: ShoppingBag },
  ];

  const productFake = Boolean(currentSite?.simulated) || currentSite?.productVerified === false;

  return (
    <div className="bg-background flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header className="bg-card flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to sites"
          render={<Link href={`/w/${workspaceSlug}/sites`} />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-mono text-sm font-medium tracking-[-0.02em]">
              {currentSite?.name ?? siteName}
            </h1>
            <Badge
              variant={currentSite?.status === "PUBLISHED" ? "default" : "secondary"}
              className="rounded-none"
            >
              {currentSite?.status === "PUBLISHED" ? "Live" : "Draft"}
            </Badge>
            {currentSite?.simulated ? (
              <Badge variant="destructive" className="rounded-none">
                SIMULATED
              </Badge>
            ) : null}
            {currentSite?.productVerified === false ? (
              <Badge variant="destructive" className="rounded-none">
                UNVERIFIED
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground truncate font-mono text-[10px]">
            /{currentSite?.slug ?? siteSlug}
          </p>
        </div>

        <nav className="bg-muted ml-4 hidden items-center border p-0.5 sm:flex">
          {views.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition",
                view === item.id
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {canEdit ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Rename site"
                onClick={() => {
                  setRenameValue(currentSite?.name ?? siteName);
                  setRenameOpen(true);
                }}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Delete site"
                className="text-destructive hover:text-destructive"
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    confirm(
                      `Delete “${currentSite?.name ?? siteName}”? Listings and checkout config for this site are removed too.`,
                    )
                  ) {
                    remove.mutate({ id: siteId });
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          ) : null}
          <PresenceBar
            channel={sitePresenceChannel(siteId)}
            self={{ userId: user.id, name: user.name, avatarUrl: user.avatarUrl }}
          />
          {collabSession ? (
            <Badge variant="secondary" className="hidden rounded-none sm:inline-flex">
              Multiplayer
            </Badge>
          ) : null}
          {currentSite?.builderUrl ? (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-none"
              render={<a href={currentSite.builderUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLink />
              <span className="hidden md:inline">Open in v0</span>
            </Button>
          ) : null}
          {currentSite?.publishedUrl ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open live site"
              render={<a href={currentSite.publishedUrl} target="_blank" rel="noreferrer" />}
            >
              <Globe className="size-4" />
            </Button>
          ) : null}
          {canPublish && !currentSite?.simulated ? (
            <Button
              size="sm"
              className="rounded-none"
              disabled={busy || !currentSite?.builderVersionId}
              onClick={() => publish.mutate({ id: siteId })}
            >
              {publish.isPending ? <Loader2 className="animate-spin" /> : <Rocket />}
              {currentSite?.status === "PUBLISHED" ? "Republish" : "Publish"}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="bg-card flex w-[340px] shrink-0 flex-col border-r">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
            <FoundryMarkIcon className="size-4" />
            <p className="font-mono text-xs font-medium tracking-[0.04em]">Foundry Site Agent</p>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
            {workspace.isLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 className="size-3.5 animate-spin" />
                Loading conversation…
              </div>
            ) : messages.length ? (
              messages.map((message) => (
                <article key={message.id} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center text-[10px] font-semibold",
                        message.role === "assistant"
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {message.role === "assistant" ? "AI" : "You"}
                    </span>
                    <span className="text-xs font-medium">
                      {message.role === "assistant" ? "Foundry" : "You"}
                    </span>
                    {message.createdAt ? (
                      <span className="text-muted-foreground ml-auto text-[9px]">
                        {new Intl.DateTimeFormat(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(message.createdAt))}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-foreground/85 pl-8 text-xs leading-5 whitespace-pre-wrap">
                    {message.content}
                  </p>
                </article>
              ))
            ) : workspace.error ? (
              <p className="text-destructive text-xs">{workspace.error.message}</p>
            ) : (
              <p className="text-muted-foreground text-xs">No messages yet.</p>
            )}
            {streamBusy || revise.isPending || optimisticUser ? (
              <div className="flex items-center gap-2 pl-8">
                <Loader2 className="text-primary size-3.5 animate-spin" />
                <span className="text-muted-foreground text-xs">
                  {stream?.status === "generated"
                    ? "Syncing preview and source…"
                    : stream?.status === "publishing"
                      ? "Publishing the current revision…"
                      : "Editing your site…"}
                </span>
              </div>
            ) : null}
            {stream?.status === "failed" ? (
              <p className="text-destructive pl-8 text-xs">
                {stream.message ?? "Site generation failed."}
              </p>
            ) : null}
          </div>

          {collabQuery.isFetched && collabSession ? (
            <CollaborativeSitePrompt
              session={collabSession}
              disabled={!canEdit || busy}
              sending={revise.isPending || Boolean(optimisticUser)}
              error={error}
              onSend={sendPrompt}
            />
          ) : (
            <form
              className="shrink-0 border-t p-3"
              onSubmit={(event) => {
                event.preventDefault();
                sendPrompt(prompt);
              }}
            >
              {error ? (
                <p className="text-destructive mb-2 border border-current/20 px-2 py-1.5 font-mono text-[10px]">
                  {error}
                </p>
              ) : null}
              <div className="bg-background focus-within:border-primary border p-2 transition-colors">
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ask Foundry to change the site…"
                  rows={3}
                  maxLength={2000}
                  disabled={!canEdit || busy}
                  className="min-h-16 resize-none rounded-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendPrompt(prompt);
                    }
                  }}
                />
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground px-1 font-mono text-[9px]">
                    Enter to send · Shift+Enter for newline
                  </span>
                  <Button
                    type="submit"
                    size="icon-sm"
                    className="rounded-none"
                    disabled={!canEdit || busy || !prompt.trim()}
                    aria-label="Send site revision"
                  >
                    {revise.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center border-b px-3 sm:hidden">
            {views.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 py-2 text-xs",
                  view === item.id ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="size-3.5" />
                {item.label}
              </button>
            ))}
          </div>

          {view === "preview" ? (
            <>
              {productFake ? (
                <div
                  role="alert"
                  className="border-destructive/40 bg-destructive text-destructive-foreground flex shrink-0 items-start gap-2.5 border-b px-3 py-2.5"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <div className="min-w-0 font-mono text-[11px] leading-relaxed tracking-[0.02em]">
                    <p className="font-medium tracking-[0.08em] uppercase">
                      {currentSite?.simulated ? "SIMULATED site" : "UNVERIFIED product"}
                    </p>
                    <p className="mt-0.5 opacity-90">
                      {currentSite?.simulated
                        ? "This page is fake demo output — it was not generated by the real builder and must not be published or sold as a real product."
                        : "Linked product has not passed Verify. Specs are design targets, not proven results — do not present this site as a verified product."}
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="bg-card flex h-10 shrink-0 items-center justify-center border-b px-3">
                <div className="bg-muted flex items-center border p-0.5">
                  {(
                    [
                      ["desktop", Monitor],
                      ["tablet", Tablet],
                      ["mobile", Smartphone],
                    ] as const
                  ).map(([size, Icon]) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setPreviewSize(size)}
                      className={cn(
                        "p-1.5",
                        previewSize === size
                          ? "bg-background text-foreground"
                          : "text-muted-foreground",
                      )}
                      aria-label={`${size} preview`}
                    >
                      <Icon className="size-3.5" />
                    </button>
                  ))}
                </div>
              </div>
              <div
                className={cn(
                  "min-h-0 flex-1",
                  previewSize === "desktop" ? "overflow-hidden" : "overflow-auto bg-muted/40",
                )}
              >
                <div
                  className={cn(
                    "bg-background relative h-full overflow-hidden transition-[width]",
                    previewSize === "desktop"
                      ? "w-full"
                      : "border-border mx-auto min-h-full border-x",
                  )}
                  style={
                    previewSize === "desktop"
                      ? undefined
                      : { width: PREVIEW_WIDTH[previewSize], maxWidth: "100%" }
                  }
                >
                  {displayPreviewUrl ? (
                    <>
                      <iframe
                        key={displayPreviewUrl}
                        src={displayPreviewUrl}
                        title={`${siteName} preview`}
                        className="block h-full w-full border-0"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                      />
                      {busy && (revise.isPending || streamBusy) ? (
                        <div className="bg-background/70 absolute inset-0 flex flex-col items-center justify-center gap-2">
                          <Loader2 className="text-primary size-5 animate-spin" />
                          <p className="text-muted-foreground font-mono text-[11px] tracking-[0.12em] uppercase">
                            Updating preview…
                          </p>
                        </div>
                      ) : null}
                    </>
                  ) : busy && (revise.isPending || streamBusy) ? (
                    <div className="text-muted-foreground flex h-full min-h-0 flex-col items-center justify-center gap-3 text-center">
                      <Loader2 className="text-primary size-5 animate-spin" />
                      <p className="font-mono text-[11px] tracking-[0.12em] uppercase">
                        Building preview…
                      </p>
                    </div>
                  ) : (
                    <div className="text-muted-foreground flex h-full min-h-0 flex-col items-center justify-center gap-3 text-center">
                      <PanelRight className="size-6" />
                      <div>
                        <p className="text-foreground text-sm font-medium">No preview available</p>
                        <p className="mt-1 text-xs">
                          {currentSite?.simulated
                            ? "Configure V0_API_KEY and generate a real revision."
                            : "The builder has not returned a preview yet."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}

          {view === "code" ? (
            <div className="min-h-0 flex-1">
              <SiteCodeWorkspace files={currentWorkspace?.files ?? []} />
            </div>
          ) : null}

          {view === "media" ? (
            <SiteMediaPanel
              siteId={siteId}
              projectId={currentSite?.project?.id ?? null}
              canEdit={canEdit}
            />
          ) : null}

          {view === "commerce" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {productFake ? (
                <div
                  role="alert"
                  className="border-destructive/40 bg-destructive text-destructive-foreground flex shrink-0 items-start gap-2.5 border-b px-3 py-2.5"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <div className="min-w-0 font-mono text-[11px] leading-relaxed">
                    <p className="font-medium tracking-[0.08em] uppercase">
                      Selling blocked for fake / unverified product
                    </p>
                    <p className="mt-0.5 opacity-90">
                      {currentSite?.simulated
                        ? "SIMULATED sites cannot connect a real store or activate listings."
                        : "Approve Verify on the linked project before presenting this as a sellable product."}
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-auto">
                <CommercePanel siteId={siteId} canManage={canManageCommerce} />
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename site</DialogTitle>
            <DialogDescription>Updates the display name and URL slug.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!renameValue.trim()) return;
              update.mutate({ id: siteId, name: renameValue.trim() });
            }}
          >
            <Input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              maxLength={80}
              required
              aria-label="Site name"
              className="rounded-none"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending || !renameValue.trim()}>
                {update.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
