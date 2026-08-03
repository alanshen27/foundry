"use client";

import { useState } from "react";
import { Check, MessageSquare, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

/**
 * Comments pinned to spots on a visual canvas. One layer serves every surface:
 * the parent supplies the surface string (matching the live cursor/lock
 * surfaces) and a projector from the comment's stored coordinates to CSS
 * pixels inside the overlay, so PCB (board mm) and CAD (normalized viewport)
 * share everything else — query, composer, thread, resolve, delete.
 */
export type CommentPoint = { x: number; y: number };

/** CSS position inside the overlay — px numbers (PCB) or percents (CAD). */
export type ScreenPoint = { x: number | string; y: number | string };

export function ViewportComments({
  projectId,
  branchId,
  surface,
  toScreen,
  pending,
  onClearPending,
  viewerId,
}: {
  projectId: string;
  branchId: string;
  surface: string;
  /** Projects stored surface coordinates to a CSS position in this overlay. */
  toScreen: (point: CommentPoint) => ScreenPoint | null;
  /** Where the user just clicked to start a comment, in surface coordinates. */
  pending: CommentPoint | null;
  onClearPending: () => void;
  viewerId: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const utils = trpc.useUtils();
  const query = trpc.comments.list.useQuery(
    { projectId, branchId, surface },
    // Collaborators' pins appear without a reload; 5s is plenty for discussion.
    { refetchInterval: 5_000 },
  );
  const invalidate = () => void utils.comments.list.invalidate({ projectId, branchId, surface });
  const add = trpc.comments.add.useMutation({ onSuccess: invalidate });
  const resolve = trpc.comments.resolve.useMutation({ onSuccess: invalidate });
  const remove = trpc.comments.remove.useMutation({ onSuccess: invalidate });

  const comments = query.data ?? [];
  const open = comments.find((c) => c.id === openId) ?? null;
  const openAt = open ? toScreen({ x: open.x, y: open.y }) : null;
  const pendingAt = pending ? toScreen(pending) : null;

  const submit = () => {
    const body = draft.trim();
    if (!body || !pending) return;
    add.mutate({ projectId, branchId, surface, x: pending.x, y: pending.y, body });
    setDraft("");
    onClearPending();
  };

  return (
    <div className="absolute inset-0 z-[60]" style={{ pointerEvents: "none" }}>
      {comments.map((comment) => {
        const at = toScreen({ x: comment.x, y: comment.y });
        if (!at) return null;
        return (
          <button
            key={comment.id}
            type="button"
            className={cn(
              "bg-primary text-primary-foreground absolute flex size-6 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-bl-none border shadow-md transition-transform hover:scale-110",
              comment.id === openId && "ring-ring ring-2",
            )}
            style={{ left: at.x, top: at.y, pointerEvents: "auto" }}
            onClick={(e) => {
              e.stopPropagation();
              setOpenId(comment.id === openId ? null : comment.id);
            }}
            aria-label={`Comment by ${comment.authorName}`}
          >
            <MessageSquare className="size-3" />
          </button>
        );
      })}

      {open && openAt ? (
        <div
          className="bg-card/95 absolute z-[61] w-64 rounded-lg border p-3 text-xs shadow-xl backdrop-blur-md"
          style={{
            left: openAt.x,
            top: openAt.y,
            marginLeft: 12,
            pointerEvents: "auto",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="font-semibold">{open.authorName}</span>
            <span className="text-muted-foreground">
              {new Date(open.createdAt).toLocaleString()}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              onClick={() => setOpenId(null)}
              aria-label="Close comment"
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <p className="mb-2 leading-relaxed whitespace-pre-wrap">{open.body}</p>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              disabled={resolve.isPending}
              onClick={() => {
                resolve.mutate({ id: open.id, resolved: true });
                setOpenId(null);
              }}
            >
              <Check className="size-3" /> Resolve
            </Button>
            {open.authorId === viewerId ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive h-6 gap-1 px-2 text-[11px]"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate({ id: open.id });
                  setOpenId(null);
                }}
              >
                <Trash2 className="size-3" /> Delete
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {pending && pendingAt ? (
        <div
          className="bg-card/95 absolute z-[62] w-64 rounded-lg border p-2 shadow-xl backdrop-blur-md"
          style={{
            left: pendingAt.x,
            top: pendingAt.y,
            marginLeft: 12,
            pointerEvents: "auto",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") {
                setDraft("");
                onClearPending();
              }
            }}
            placeholder="Comment… (Enter to post)"
            className="bg-background h-16 w-full resize-none rounded-md border p-2 text-xs outline-none"
            aria-label="New comment"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setDraft("");
                onClearPending();
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 px-2 text-[11px]"
              disabled={!draft.trim() || add.isPending}
              onClick={submit}
            >
              Comment
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
