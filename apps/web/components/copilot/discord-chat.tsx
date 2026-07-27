"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { UIMessage } from "ai";
import { AtSign, Hash, Loader2, Send, Sparkles, Square } from "lucide-react";
import { FoundyrMarkIcon } from "@/components/foundry-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  filterMentionTargets,
  insertMention,
  mentionQueryAt,
  mentionsAi,
  splitMentions,
  type MentionTarget,
} from "@/lib/copilot/mentions";
import { ChannelRail } from "./channel-rail";
import { ToolCard, type ToolPart } from "./chat-sidebar";
import { Markdown } from "./markdown";
import { useCopilot } from "./copilot-provider";

const SUGGESTIONS = [
  "@AI Design a smart plant moisture sensor under $30",
  "@AI Add battery-life requirements and matching checks",
  "@AI Review the BOM for cost savings",
];

const COPILOT_NAME = "Foundry Copilot";

type Viewer = { id: string; name: string; avatarUrl?: string | null };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((p) => p[0] ?? "").join("");
  return (letters || name.slice(0, 2)).toUpperCase();
}

function Avatar({ message, viewer }: { message: UIMessage; viewer: Viewer }) {
  if (message.role !== "user") {
    return (
      <div className="size-10 shrink-0 overflow-hidden rounded-full">
        <FoundyrMarkIcon className="size-10" />
      </div>
    );
  }
  if (viewer.avatarUrl) {
    return (
      <img
        src={viewer.avatarUrl}
        alt={viewer.name}
        className="size-10 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
      {initials(viewer.name)}
    </div>
  );
}

/** One Discord-style row: avatar gutter, author line, then message parts. */
function ChatMessage({
  message,
  viewer,
  grouped,
}: {
  message: UIMessage;
  viewer: Viewer;
  /** Continuation of the previous author's block — hide avatar and name. */
  grouped: boolean;
}) {
  const isUser = message.role === "user";
  const hasContent = message.parts.some(
    (p) =>
      (p.type === "text" && p.text.trim().length > 0) ||
      p.type.startsWith("tool-") ||
      p.type === "dynamic-tool",
  );

  return (
    <div
      className={cn(
        "hover:bg-muted/30 group flex gap-4 px-6",
        grouped ? "py-0.5" : "mt-4 py-0.5 first:mt-0",
      )}
    >
      <div className="w-10 shrink-0">
        {grouped ? null : <Avatar message={message} viewer={viewer} />}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 pb-0.5">
        {grouped ? null : (
          <div className="flex items-center gap-2">
            <span className={cn("text-sm font-semibold", !isUser && "text-primary")}>
              {isUser ? viewer.name : COPILOT_NAME}
            </span>
            {isUser ? null : (
              <span className="bg-primary/15 text-primary rounded px-1.5 py-px text-[10px] font-semibold uppercase">
                AI
              </span>
            )}
          </div>
        )}

        {message.parts.map((part, i) => {
          const partKey =
            "toolCallId" in part && typeof part.toolCallId === "string"
              ? part.toolCallId
              : `${part.type}-${i}`;
          if (part.type === "text" && part.text.trim()) {
            return isUser ? (
              <p
                key={partKey}
                className="text-foreground/90 text-[15px] leading-relaxed whitespace-pre-wrap"
              >
                {splitMentions(part.text).map((seg, j) =>
                  seg.kind === "mention" ? (
                    <span
                      key={j}
                      className="bg-primary/15 text-primary rounded px-1 font-medium"
                    >
                      {seg.text}
                    </span>
                  ) : (
                    <span key={j}>{seg.text}</span>
                  ),
                )}
              </p>
            ) : (
              <div key={partKey} className="text-[15px] leading-relaxed">
                <Markdown text={part.text} />
              </div>
            );
          }
          if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
            return (
              <div key={partKey} className="max-w-xl">
                <ToolCard part={part as ToolPart} />
              </div>
            );
          }
          return null;
        })}

        {hasContent ? null : (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-3.5 animate-spin" />
            Working…
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Full-window Discord-style chat (channel rail + message pane).
 * Opened via "Open in a new window" from the docked sidebar.
 */
export function DiscordChat({
  projectName,
  workspaceName,
  user,
}: {
  projectName: string;
  workspaceName: string;
  user: Viewer;
}) {
  const { messages, status, busy, error, send, stop, channels, activeChannelId } = useCopilot();
  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const channelName = activeChannel?.name ?? "general";

  const [input, setInput] = useState("");
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend = mentionsAi(input) && status !== "submitted" && status !== "streaming";
  const mentionActive = useMemo(() => mentionQueryAt(input, caret), [input, caret]);
  const mentionOptions = useMemo(
    () => (mentionActive ? filterMentionTargets(mentionActive.query) : []),
    [mentionActive],
  );
  const mentionOpen = mentionOptions.length > 0 && !mentionDismissed;

  useEffect(() => {
    setMentionIndex(0);
    setMentionDismissed(false);
  }, [mentionActive?.start, mentionActive?.query]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  function applyMention(target: MentionTarget) {
    const next = insertMention(input, caret, target);
    setInput(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  }

  function trySend() {
    if (!canSend) return;
    send(input);
    setInput("");
    setCaret(0);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    trySend();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const target = mentionOptions[mentionIndex];
        if (target) applyMention(target);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      trySend();
    }
  }

  return (
    <div className="bg-background text-foreground flex h-screen">
      <ChannelRail title={projectName} subtitle={workspaceName} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-6">
          <Hash className="text-muted-foreground size-5 shrink-0" />
          <h1 className="truncate text-[15px] font-semibold">{channelName}</h1>
          <span className="bg-border mx-1 hidden h-5 w-px shrink-0 sm:block" />
          <p className="text-muted-foreground hidden truncate text-xs sm:block">
            Mention @AI to work with the copilot
          </p>
          {busy ? (
            <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1.5 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              working…
            </span>
          ) : null}
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col gap-4 px-6 pt-8">
              <div className="bg-muted flex size-16 items-center justify-center rounded-full">
                <Hash className="text-foreground size-8" />
              </div>
              <div className="flex flex-col gap-1">
                <h2 className="text-3xl font-bold">Welcome to #{channelName}</h2>
                <p className="text-muted-foreground max-w-xl text-[15px] leading-relaxed">
                  This is the start of the channel. Mention{" "}
                  <span className="text-primary font-semibold">@AI</span> and the Foundry copilot
                  will fill out the brief, requirements, BOM, circuit, 3D model, and checks.
                </p>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => send(s)}
                    className="bg-muted/60 hover:bg-muted rounded-full border px-3.5 py-1.5 text-left text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <ChatMessage
                key={m.id}
                message={m}
                viewer={user}
                grouped={messages[i - 1]?.role === m.role}
              />
            ))
          )}
          {error ? (
            <p className="text-destructive mt-4 px-6 text-sm">
              {error.message.includes("OPENAI_API_KEY") || error.message.includes("not configured")
                ? "AI is not configured. Add OPENAI_API_KEY to the root .env and restart."
                : error.message}
            </p>
          ) : null}
        </div>

        <form onSubmit={onSubmit} className="shrink-0 px-6 pb-5">
          <div className="relative">
            {mentionOpen ? (
              <div
                role="listbox"
                aria-label="Mentions"
                className="bg-popover absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-lg border shadow-lg"
              >
                {mentionOptions.map((option, i) => (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={i === mentionIndex}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMention(option);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                      i === mentionIndex ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <AtSign className="text-primary size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {option.description}
                      </span>
                    </span>
                    {option.invokesAi ? (
                      <Sparkles className="text-primary size-3.5 shrink-0" />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="bg-muted/70 focus-within:ring-ring/40 flex items-end gap-2 rounded-lg px-4 py-2.5 focus-within:ring-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setCaret(e.target.selectionStart);
                }}
                onClick={(e) => setCaret(e.currentTarget.selectionStart)}
                onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                onKeyDown={onKeyDown}
                placeholder={`Message #${channelName}`}
                rows={1}
                className="placeholder:text-muted-foreground text-foreground max-h-40 min-h-6 flex-1 resize-none bg-transparent text-[15px] leading-6 outline-none"
                aria-label="Copilot message"
              />
              {busy ? (
                <Button
                  type="button"
                  size="icon-sm"
                  onClick={(e) => {
                    e.preventDefault();
                    stop();
                  }}
                  aria-label="Stop stream"
                  title="Stop"
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button type="submit" size="icon-sm" disabled={!canSend} aria-label="Send">
                  <Send className="size-3.5" />
                </Button>
              )}
            </div>

            <p className="text-muted-foreground mt-1.5 h-4 px-1 text-[11px]">
              {busy ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" />
                  {COPILOT_NAME} is working…
                </span>
              ) : input.trim() && !mentionsAi(input) ? (
                <>
                  Mention <span className="text-foreground font-medium">@AI</span> to send to the
                  copilot
                </>
              ) : (
                <>
                  <span className="text-foreground font-medium">Enter</span> to send ·{" "}
                  <span className="text-foreground font-medium">Shift+Enter</span> for a new line
                </>
              )}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
