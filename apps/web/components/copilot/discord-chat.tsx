"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { UIMessage } from "ai";
import { AtSign, Loader2, Send, Sparkles, Square, XCircle } from "lucide-react";
import { FoundryMarkIcon } from "@/components/foundry-mark";
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
import { isAssistantFailureText } from "@/lib/copilot/messages";
import { groupAssistantPartBlocks } from "@/lib/copilot/part-blocks";
import {
  isMessageDeleted,
  isOwnUserMessage,
  messageAuthorKey,
  messageDisplayName,
  messagePlainText,
  readChatMeta,
  type ChatReactionEmoji,
  type FoundryUIMessage,
} from "@/lib/copilot/chat-message-meta";
import { ChannelRail } from "./channel-rail";
import { CopilotThinkingRow, ToolCallGroup, type ToolPart } from "./chat-sidebar";
import {
  MessageActionBar,
  MessageEditForm,
  MessageReactions,
  MessageReplyQuote,
  ReplyPreviewBar,
} from "./message-actions";
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

function Avatar({ message }: { message: UIMessage }) {
  if (message.role !== "user") {
    return (
      <div className="bg-primary/10 border-border flex size-9 shrink-0 items-center justify-center overflow-hidden border">
        <FoundryMarkIcon className="size-5" />
      </div>
    );
  }
  const meta = readChatMeta(message);
  const name = messageDisplayName(message);
  if (meta.authorAvatarUrl) {
    return (
      <img
        src={meta.authorAvatarUrl}
        alt={name}
        className="border-border size-9 shrink-0 border object-cover"
      />
    );
  }
  return (
    <div className="bg-muted text-foreground border-border flex size-9 shrink-0 items-center justify-center border font-mono text-[11px] font-semibold tracking-[0.04em]">
      {initials(name)}
    </div>
  );
}

/** One Discord-style row: avatar gutter, author line, then message parts. */
function ChatMessage({
  message,
  viewer,
  grouped,
  failed,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: {
  message: UIMessage;
  viewer: Viewer;
  /** Continuation of the previous author's block — hide avatar and name. */
  grouped: boolean;
  failed?: boolean;
  onReply: () => void;
  onEdit: (text: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onReact: (emoji: ChatReactionEmoji) => void;
}) {
  const [editing, setEditing] = useState(false);
  const isUser = message.role === "user";
  const deleted = isMessageDeleted(message);
  const meta = readChatMeta(message);
  const authorName = messageDisplayName(message, COPILOT_NAME);
  const hasContent = message.parts.some(
    (p) =>
      (p.type === "text" && p.text.trim().length > 0) ||
      p.type.startsWith("tool-") ||
      p.type === "dynamic-tool",
  );
  const stampedFailed = message.parts.some(
    (p) => p.type === "text" && isAssistantFailureText(p.text),
  );
  const showFailed = Boolean(failed) || stampedFailed;

  return (
    <div
      className={cn(
        "hover:bg-muted/30 group relative flex gap-3 px-5",
        grouped ? "py-0.5" : "mt-4 py-0.5 first:mt-0",
      )}
    >
      <div className="w-9 shrink-0">{grouped ? null : <Avatar message={message} />}</div>

      <div className="relative flex min-w-0 flex-1 flex-col gap-1 pb-0.5">
        {!deleted ? (
          <MessageActionBar
            message={message}
            viewerId={viewer.id}
            onReply={onReply}
            onEdit={() => setEditing(true)}
            onDelete={() => void onDelete()}
            onReact={onReact}
          />
        ) : null}

        {grouped ? null : (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-mono text-[12px] font-medium tracking-[0.04em]",
                !isUser && "text-primary",
                isUser && isOwnUserMessage(message, viewer.id) && "text-foreground",
              )}
            >
              {authorName}
            </span>
            {isUser ? null : (
              <span className="bg-primary text-primary-foreground px-1.5 py-px font-mono text-[9px] font-semibold tracking-[0.1em] uppercase">
                AI
              </span>
            )}
            {meta.editedAt && !deleted ? (
              <span className="text-muted-foreground font-mono text-[10px]">(edited)</span>
            ) : null}
          </div>
        )}

        <MessageReplyQuote message={message} />

        {editing ? (
          <MessageEditForm
            initialText={messagePlainText(message)}
            onCancel={() => setEditing(false)}
            onSave={async (text) => {
              await onEdit(text);
              setEditing(false);
            }}
          />
        ) : deleted ? (
          <p className="text-muted-foreground text-sm italic">Message deleted</p>
        ) : (
          groupAssistantPartBlocks(message.parts, message.id).map((block) => {
            if (block.type === "text") {
              if (!isUser && isAssistantFailureText(block.part.text)) {
                return (
                  <p
                    key={block.key}
                    className="text-destructive flex items-start gap-2 text-sm leading-relaxed whitespace-pre-wrap"
                  >
                    <XCircle className="mt-0.5 size-3.5 shrink-0" />
                    <span>{block.part.text}</span>
                  </p>
                );
              }
              return isUser ? (
                <p
                  key={block.key}
                  className="text-foreground/90 text-[15px] leading-relaxed whitespace-pre-wrap"
                >
                  {splitMentions(block.part.text).map((seg, j) =>
                    seg.kind === "mention" ? (
                      <span
                        key={j}
                        className="bg-primary/15 text-primary rounded-none px-1 font-medium"
                      >
                        {seg.text}
                      </span>
                    ) : (
                      <span key={j}>{seg.text}</span>
                    ),
                  )}
                </p>
              ) : (
                <div key={block.key} className="text-[15px] leading-relaxed">
                  <Markdown text={block.part.text} />
                </div>
              );
            }
            return (
              <div key={block.key} className="max-w-xl">
                <ToolCallGroup parts={block.parts as ToolPart[]} />
              </div>
            );
          })
        )}

        {!editing && !deleted ? <MessageReactions message={message} onToggle={onReact} /> : null}

        {!editing && !deleted ? (
          hasContent ? (
            showFailed && !stampedFailed ? (
              <p className="text-destructive flex items-center gap-1.5 text-sm">
                <XCircle className="size-3.5" />
                Failed
              </p>
            ) : null
          ) : showFailed ? (
            <p className="text-destructive flex items-center gap-2 text-sm">
              <XCircle className="size-3.5" />
              Failed
            </p>
          ) : (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" />
              Working…
            </p>
          )
        ) : null}
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
  const {
    messages,
    status,
    busy,
    error,
    send,
    stop,
    channels,
    activeChannelId,
    replyingTo,
    setReplyingTo,
    editMessage,
    deleteMessage,
    toggleReaction,
  } = useCopilot();
  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const channelName = activeChannel?.name ?? "general";

  const [input, setInput] = useState("");
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Notes (no @AI) stay sendable; Stop only appears while an @AI run is busy.
  const canSend = Boolean(input.trim()) && !busy;
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
    // busy: keep the optimistic thinking row in view before the first chunk.
  }, [messages, status, busy]);

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
    send(input, replyingTo ? { replyToId: replyingTo.id } : undefined);
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
        <header className="bg-card flex h-12 shrink-0 items-center gap-2 border-b px-5">
          <FoundryMarkIcon className="size-4 shrink-0" />
          <h1 className="truncate font-mono text-[13px] font-medium tracking-[0.06em] uppercase">
            {channelName}
          </h1>
          <span className="bg-border mx-1 hidden h-4 w-px shrink-0 sm:block" />
          <p className="text-muted-foreground hidden truncate font-mono text-[11px] tracking-[0.04em] sm:block">
            Mention @AI · Foundry Copilot
          </p>
          {busy ? (
            <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] uppercase">
              <Loader2 className="size-3.5 animate-spin" />
              working
            </span>
          ) : null}
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col gap-5 px-5 pt-10">
              <div className="bg-primary relative flex size-14 items-center justify-center overflow-hidden">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-30"
                  style={{
                    backgroundImage: "radial-gradient(circle, #faf9f5 0.55px, transparent 0.65px)",
                    backgroundSize: "3.5px 3.5px",
                  }}
                />
                <FoundryMarkIcon className="relative z-10 size-7 brightness-0 invert" />
              </div>
              <div className="flex flex-col gap-2">
                <h2 className="font-mono text-2xl font-medium tracking-[-0.03em]">
                  #{channelName}
                </h2>
                <p className="text-muted-foreground max-w-xl text-[14px] leading-relaxed">
                  Mention <span className="text-primary font-mono font-medium">@AI</span> and the
                  Foundry copilot will fill out the brief, requirements, BOM, circuit, 3D model, and
                  checks.
                </p>
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => send(s)}
                    className="border-border bg-card hover:border-foreground/30 rounded-none border px-3 py-2 text-left font-mono text-[12px] transition-colors disabled:pointer-events-none disabled:opacity-50"
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
                grouped={
                  i > 0 &&
                  messageAuthorKey(messages[i - 1]!) === messageAuthorKey(m) &&
                  !readChatMeta(m).replyPreview
                }
                failed={status === "error" && m.role === "assistant" && i === messages.length - 1}
                onReply={() => {
                  setReplyingTo(m as FoundryUIMessage);
                  textareaRef.current?.focus();
                }}
                onEdit={(text) => editMessage(m.id, text)}
                onDelete={() => deleteMessage(m.id)}
                onReact={(emoji) => void toggleReaction(m.id, emoji)}
              />
            ))
          )}
          {busy && messages[messages.length - 1]?.role === "user" ? (
            <div className="mt-4 flex items-center gap-3 px-5 py-0.5">
              <div className="bg-primary/10 border-border flex size-9 shrink-0 items-center justify-center overflow-hidden border">
                <FoundryMarkIcon className="size-5" />
              </div>
              <CopilotThinkingRow />
            </div>
          ) : null}
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
            {replyingTo ? (
              <ReplyPreviewBar message={replyingTo} onClear={() => setReplyingTo(null)} />
            ) : null}
            {mentionOpen ? (
              <div
                role="listbox"
                aria-label="Mentions"
                className="bg-popover absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-none border shadow-lg"
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

            <div className="bg-muted/70 focus-within:ring-ring/40 flex items-end gap-2 rounded-none px-4 py-2.5 focus-within:ring-2">
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
                placeholder={
                  replyingTo
                    ? `Reply to ${messageDisplayName(replyingTo)}`
                    : `Message #${channelName}`
                }
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
                  Note by default — mention <span className="text-foreground font-medium">@AI</span>{" "}
                  for the copilot
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
