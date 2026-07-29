"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { UIMessage } from "ai";
import { Pencil, Reply, SmilePlus, Trash2 } from "lucide-react";
import {
  CHAT_REACTION_EMOJIS,
  isMessageDeleted,
  isOwnUserMessage,
  messagePlainText,
  readChatMeta,
  type ChatReactionEmoji,
  type FoundryUIMessage,
} from "@/lib/copilot/chat-message-meta";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ReplyPreviewBar({
  message,
  onClear,
}: {
  message: FoundryUIMessage;
  onClear: () => void;
}) {
  const meta = readChatMeta(message);
  const author =
    meta.authorName?.trim() || (message.role === "assistant" ? "Foundry Copilot" : "Member");
  return (
    <div className="border-border bg-muted/50 mb-2 flex items-start gap-2 border-l-2 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] tracking-[0.06em] uppercase opacity-70">
          Replying to {author}
        </p>
        <p className="text-muted-foreground truncate text-xs">{messagePlainText(message) || "…"}</p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="text-muted-foreground hover:text-foreground shrink-0 px-1 text-xs"
        aria-label="Cancel reply"
      >
        ✕
      </button>
    </div>
  );
}

export function MessageReplyQuote({ message }: { message: UIMessage }) {
  const preview = readChatMeta(message).replyPreview;
  if (!preview) return null;
  return (
    <div className="border-border/80 text-muted-foreground mb-1 border-l-2 pl-2 text-xs leading-snug">
      <span className="text-foreground/80 font-medium">{preview.authorName}</span>
      <span className="ml-1.5">{preview.text}</span>
    </div>
  );
}

export function MessageReactions({
  message,
  onToggle,
  disabled,
}: {
  message: UIMessage;
  onToggle: (emoji: ChatReactionEmoji) => void;
  disabled?: boolean;
}) {
  const reactions = readChatMeta(message).reactions ?? [];
  if (reactions.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          disabled={disabled}
          onClick={() => onToggle(reaction.emoji as ChatReactionEmoji)}
          className={cn(
            "border-border inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[11px] transition-colors",
            reaction.me
              ? "bg-primary/15 border-primary/40 text-foreground"
              : "bg-muted/50 hover:bg-muted text-muted-foreground",
          )}
          aria-label={`${reaction.emoji} ${reaction.count}`}
        >
          <span>{reaction.emoji}</span>
          <span>{reaction.count}</span>
        </button>
      ))}
    </div>
  );
}

export function MessageActionBar({
  message,
  viewerId,
  onReply,
  onEdit,
  onDelete,
  onReact,
  align = "left",
}: {
  message: UIMessage;
  viewerId: string;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: ChatReactionEmoji) => void;
  align?: "left" | "right";
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const deleted = isMessageDeleted(message);
  if (deleted) return null;
  const own = isOwnUserMessage(message, viewerId);
  const canEdit = own;

  return (
    <div
      className={cn(
        "pointer-events-none absolute -top-3 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
        align === "right" ? "right-0" : "right-0",
      )}
    >
      <div className="border-border bg-card flex items-center border shadow-sm">
        <div className="relative">
          <button
            type="button"
            className="text-muted-foreground hover:bg-muted hover:text-foreground p-1.5"
            aria-label="Add reaction"
            onClick={() => setPickerOpen((open) => !open)}
          >
            <SmilePlus className="size-3.5" />
          </button>
          {pickerOpen ? (
            <div className="border-border bg-popover absolute top-full left-0 z-20 mt-1 flex gap-0.5 border p-1 shadow-md">
              {CHAT_REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="hover:bg-muted px-1.5 py-0.5 text-sm"
                  onClick={() => {
                    onReact(emoji);
                    setPickerOpen(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:bg-muted hover:text-foreground p-1.5"
          aria-label="Reply"
          onClick={onReply}
        >
          <Reply className="size-3.5" />
        </button>
        {canEdit ? (
          <>
            <button
              type="button"
              className="text-muted-foreground hover:bg-muted hover:text-foreground p-1.5"
              aria-label="Edit"
              onClick={onEdit}
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:bg-muted hover:text-destructive p-1.5"
              aria-label="Delete"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function MessageEditForm({
  initialText,
  onSave,
  onCancel,
}: {
  initialText: string;
  onSave: (text: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        className="border-border bg-background text-foreground w-full resize-none border px-2 py-1.5 text-sm outline-none"
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving || !text.trim()}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
