"use client";

/**
 * Shared site-revision prompt bound to a Yjs document via Hocuspocus.
 * Peers co-edit the draft before anyone sends; content is CRDT-owned.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { SITE_PROMPT_YTEXT_KEY, awarenessColorForUser } from "@foundry/collaboration/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";

export type SiteCollabSession = {
  url: string;
  token: string;
  documentName: string;
  canEdit: boolean;
  user: { id: string; name: string; avatarUrl?: string | null };
};

type Peer = { name: string; color: string };

type Props = {
  session: SiteCollabSession;
  disabled: boolean;
  sending: boolean;
  error: string | null;
  onSend: (text: string) => void;
};

export function CollaborativeSitePrompt({ session, disabled, sending, error, onSend }: Props) {
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const ytextRef = useRef<Y.Text | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const applyingRemote = useRef(false);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText(SITE_PROMPT_YTEXT_KEY);
    const provider = new HocuspocusProvider({
      url: session.url,
      name: session.documentName,
      document: ydoc,
      token: session.token,
      onStatus: ({ status: next }) => {
        if (next === "connected") setStatus("connected");
        else if (next === "disconnected") setStatus("disconnected");
        else setStatus("connecting");
      },
    });

    provider.awareness?.setLocalStateField("user", {
      name: session.user.name,
      color: awarenessColorForUser(session.user.id),
    });

    const syncFromY = () => {
      applyingRemote.current = true;
      const next = ytext.toString();
      setValue(next);
      const el = textareaRef.current;
      if (el && document.activeElement === el) {
        // Keep caret at end on remote inserts — good enough for a short prompt.
        const pos = el.selectionStart;
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            const clamped = Math.min(pos, next.length);
            textareaRef.current.setSelectionRange(clamped, clamped);
          }
        });
      }
      applyingRemote.current = false;
    };

    ytext.observe(syncFromY);
    syncFromY();

    const syncPeers = () => {
      const states = provider.awareness?.getStates() ?? new Map();
      const next: Peer[] = [];
      for (const [clientId, state] of states) {
        if (clientId === provider.awareness?.clientID) continue;
        const user = (state as { user?: { name?: string; color?: string } }).user;
        if (user?.name) {
          next.push({
            name: user.name,
            color: user.color ?? "hsl(0 0% 50%)",
          });
        }
      }
      setPeers(next);
    };
    provider.awareness?.on("change", syncPeers);
    syncPeers();

    ydocRef.current = ydoc;
    providerRef.current = provider;
    ytextRef.current = ytext;

    return () => {
      ytext.unobserve(syncFromY);
      provider.awareness?.off("change", syncPeers);
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      ytextRef.current = null;
    };
  }, [session.url, session.documentName, session.token, session.user.id, session.user.name]);

  function replaceYText(next: string) {
    const ytext = ytextRef.current;
    if (!ytext || applyingRemote.current) return;
    const current = ytext.toString();
    if (current === next) return;
    ydocRef.current?.transact(() => {
      ytext.delete(0, ytext.length);
      if (next.length > 0) ytext.insert(0, next);
    });
  }

  function clearYText() {
    const ytext = ytextRef.current;
    if (!ytext) return;
    ydocRef.current?.transact(() => {
      ytext.delete(0, ytext.length);
    });
  }

  function submit() {
    const text = value.trim();
    if (!text || disabled || sending || !session.canEdit) return;
    clearYText();
    onSend(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const readOnly = !session.canEdit || disabled || sending;

  return (
    <form
      className="shrink-0 border-t p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {error ? (
        <p className="text-destructive mb-2 border border-current/20 px-2 py-1.5 font-mono text-[10px]">
          {error}
        </p>
      ) : null}
      <div className="bg-background focus-within:border-primary border p-2 transition-colors">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            const next = event.target.value.slice(0, 2000);
            setValue(next);
            replaceYText(next);
          }}
          placeholder="Ask Foundry to change the site…"
          rows={3}
          maxLength={2000}
          disabled={readOnly}
          className="min-h-16 resize-none rounded-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
          onKeyDown={onKeyDown}
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5 px-1">
            <span className="text-muted-foreground font-mono text-[9px]">
              Enter to send · Shift+Enter for newline
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "font-mono text-[9px]",
                  status === "connected"
                    ? "text-emerald-700 dark:text-emerald-300"
                    : status === "connecting"
                      ? "text-amber-800 dark:text-amber-200"
                      : "text-destructive",
                )}
              >
                {status === "connected"
                  ? "Live prompt"
                  : status === "connecting"
                    ? "Connecting…"
                    : "Offline draft"}
              </span>
              {peers.length > 0 ? (
                <span className="text-muted-foreground truncate font-mono text-[9px]">
                  · with {peers.map((p) => p.name).join(", ")}
                </span>
              ) : null}
            </div>
          </div>
          <Button
            type="submit"
            size="icon-sm"
            className="rounded-none"
            disabled={readOnly || !value.trim()}
            aria-label="Send site revision"
          >
            {sending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
