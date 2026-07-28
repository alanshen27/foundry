"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createOffBroadcastPort,
  createSupabaseBroadcastPort,
  siteBroadcastChannel,
  type BroadcastPort,
} from "@foundry/realtime";
import {
  ArrowLeft,
  Code2,
  ExternalLink,
  Globe,
  Loader2,
  Monitor,
  PanelRight,
  Rocket,
  Send,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Tablet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CommercePanel } from "@/components/sites/commerce-panel";
import { SiteCodeWorkspace } from "@/components/sites/site-code-workspace";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type EditorView = "preview" | "code" | "commerce";
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
  canEdit,
  canPublish,
  canManageCommerce,
}: {
  siteId: string;
  siteName: string;
  siteSlug: string;
  workspaceSlug: string;
  canEdit: boolean;
  canPublish: boolean;
  canManageCommerce: boolean;
}) {
  const utils = trpc.useUtils();
  const site = trpc.site.get.useQuery({ id: siteId });
  const workspace = trpc.site.workspace.useQuery({ id: siteId });
  const [view, setView] = useState<EditorView>("preview");
  const [previewSize, setPreviewSize] = useState<PreviewSize>("desktop");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState | null>(null);
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
      setPrompt("");
      setError(null);
      await refresh();
    },
    onError: (nextError) => setError(nextError.message),
  });

  const publish = trpc.site.publish.useMutation({
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (nextError) => setError(nextError.message),
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [workspace.data?.messages, revise.isPending]);

  useEffect(() => {
    const broadcast = createSiteBroadcastPort();
    const subscription = broadcast.subscribe(siteBroadcastChannel(siteId), (message) => {
      if (message.event !== "site-generation") return;
      const next = streamStateOf(message.payload);
      if (!next) return;
      if (streamClearTimer.current) clearTimeout(streamClearTimer.current);
      setStream(next);

      if (next.status === "generated") void refresh();

      if (next.status === "completed" || next.status === "published" || next.status === "failed") {
        void refresh();
        streamClearTimer.current = setTimeout(() => setStream(null), 2500);
      }
    });
    return () => {
      subscription.leave();
      if (streamClearTimer.current) clearTimeout(streamClearTimer.current);
    };
  }, [refresh, siteId]);

  const currentSite = site.data;
  const currentWorkspace = workspace.data;
  const previewUrl = currentSite?.previewUrl ?? currentWorkspace?.revision.previewUrl;
  const streamBusy =
    stream?.status === "started" ||
    stream?.status === "generated" ||
    stream?.status === "publishing";
  const busy = revise.isPending || publish.isPending || streamBusy;

  useEffect(() => {
    if (!streamBusy && !revise.isPending) return;

    const interval = setInterval(() => {
      void utils.site.workspace.invalidate({ id: siteId });
    }, 1200);

    return () => clearInterval(interval);
  }, [revise.isPending, siteId, streamBusy, utils]);

  const views: { id: EditorView; label: string; icon: typeof Globe }[] = [
    { id: "preview", label: "Preview", icon: Globe },
    { id: "code", label: "Code", icon: Code2 },
    { id: "commerce", label: "Commerce", icon: ShoppingBag },
  ];

  return (
    <div className="bg-background flex h-screen min-h-0 flex-col overflow-hidden">
      <header className="bg-card/80 flex h-12 shrink-0 items-center gap-2 border-b px-3 backdrop-blur">
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
            <h1 className="truncate text-sm font-semibold">{siteName}</h1>
            <Badge variant={currentSite?.status === "PUBLISHED" ? "default" : "secondary"}>
              {currentSite?.status === "PUBLISHED" ? "Live" : "Draft"}
            </Badge>
            {currentSite?.simulated ? <Badge variant="destructive">SIMULATED</Badge> : null}
          </div>
          <p className="text-muted-foreground truncate text-[10px]">/{siteSlug}</p>
        </div>

        <nav className="bg-muted/60 ml-4 hidden items-center rounded-lg p-0.5 sm:flex">
          {views.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition",
                view === item.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {currentSite?.builderUrl ? (
            <Button
              variant="ghost"
              size="sm"
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
        <aside className="bg-card/40 flex w-[340px] shrink-0 flex-col border-r">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
            <Sparkles className="text-primary size-4" />
            <div>
              <p className="text-xs font-semibold">Foundry Site Agent</p>
              <p className="text-muted-foreground text-[10px]">Persistent v0 conversation</p>
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
            {workspace.isLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 className="size-3.5 animate-spin" />
                Loading conversation…
              </div>
            ) : currentWorkspace?.messages.length ? (
              currentWorkspace.messages.map((message) => (
                <article key={message.id} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-[10px] font-semibold",
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
            {streamBusy || revise.isPending ? (
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

          <form
            className="shrink-0 border-t p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (prompt.trim()) revise.mutate({ id: siteId, prompt });
            }}
          >
            {error ? (
              <p className="text-destructive mb-2 rounded-lg border border-current/20 px-2 py-1.5 text-[10px]">
                {error}
              </p>
            ) : null}
            <div className="bg-background focus-within:border-ring focus-within:ring-ring/40 rounded-xl border p-2 focus-within:ring-2">
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask Foundry to change the site…"
                rows={3}
                maxLength={2000}
                disabled={!canEdit || busy}
                className="min-h-16 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && prompt.trim() && !busy) {
                    event.preventDefault();
                    revise.mutate({ id: siteId, prompt });
                  }
                }}
              />
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground px-1 text-[9px]">
                  Enter to send · Shift+Enter for newline
                </span>
                <Button
                  type="submit"
                  size="icon-sm"
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
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
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
              <div className="bg-card/50 flex h-10 shrink-0 items-center border-b px-3">
                <div className="bg-muted/60 mx-auto flex items-center rounded-md p-0.5">
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
                        "rounded p-1.5",
                        previewSize === size
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground",
                      )}
                      aria-label={`${size} preview`}
                    >
                      <Icon className="size-3.5" />
                    </button>
                  ))}
                </div>
              </div>
              <div className="bg-muted/30 min-h-0 flex-1 overflow-auto p-4">
                <div
                  className="bg-background mx-auto h-full min-h-[520px] overflow-hidden rounded-xl border shadow-sm transition-[width]"
                  style={{ width: PREVIEW_WIDTH[previewSize], maxWidth: "100%" }}
                >
                  {previewUrl ? (
                    <iframe
                      key={previewUrl}
                      src={previewUrl}
                      title={`${siteName} preview`}
                      className="h-full w-full border-0"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    />
                  ) : (
                    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 text-center">
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

          {view === "commerce" ? (
            <div className="min-h-0 flex-1">
              <CommercePanel siteId={siteId} canManage={canManageCommerce} />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
