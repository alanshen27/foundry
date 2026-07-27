"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ChevronDown, FolderPlus, Hash, Plus, Trash2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useCopilot } from "./copilot-provider";

const DEFAULT_CATEGORY = "Text Channels";
const DEFAULT_CHANNEL = "General";

type Props = {
  className?: string;
  /** Compact rail for the docked sidebar. */
  compact?: boolean;
  /** Header title — the project name in the pop-out window. */
  title?: string;
  subtitle?: string;
};

type Modal =
  | { kind: "create-category" }
  | { kind: "create-channel"; categoryId: string; categoryName: string }
  | { kind: "delete-channel"; channelId: string; channelName: string }
  | { kind: "delete-category"; categoryId: string; categoryName: string }
  | null;

export function ChannelRail({ className, compact, title, subtitle }: Props) {
  const {
    channels,
    categories,
    activeChannelId,
    switchChannel,
    createChannel,
    deleteChannel,
    createCategory,
    deleteCategory,
  } = useCopilot();

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<Modal>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const grouped = useMemo(() => {
    const byCat = new Map<string, typeof channels>();
    for (const cat of categories) byCat.set(cat.id, []);
    const uncategorized: typeof channels = [];
    for (const ch of channels) {
      if (ch.categoryId && byCat.has(ch.categoryId)) {
        byCat.get(ch.categoryId)!.push(ch);
      } else {
        uncategorized.push(ch);
      }
    }
    return { byCat, uncategorized };
  }, [channels, categories]);

  function openModal(next: Modal) {
    setModal(next);
    setName("");
    setError(null);
    setPending(false);
  }

  function closeModal() {
    setModal(null);
    setName("");
    setError(null);
    setPending(false);
  }

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !modal) return;
    setPending(true);
    setError(null);
    try {
      if (modal.kind === "create-category") {
        await createCategory(trimmed);
      } else if (modal.kind === "create-channel") {
        await createChannel(trimmed, modal.categoryId);
      }
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPending(false);
    }
  }

  async function submitDelete() {
    if (!modal) return;
    setPending(true);
    setError(null);
    try {
      if (modal.kind === "delete-channel") {
        await deleteChannel(modal.channelId);
      } else if (modal.kind === "delete-category") {
        await deleteCategory(modal.categoryId);
      }
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPending(false);
    }
  }

  return (
    <>
      <nav
        aria-label="Channels"
        className={cn(
          "bg-muted/40 text-foreground flex h-full min-h-0 flex-col border-r",
          compact ? "w-52" : "w-60",
          className,
        )}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">{title ?? "Channels"}</span>
            {subtitle ? (
              <span className="text-muted-foreground truncate text-[11px]">{subtitle}</span>
            ) : null}
          </div>
          <button
            type="button"
            title="Create category"
            aria-label="Create category"
            onClick={() => openModal({ kind: "create-category" })}
            className="text-muted-foreground hover:bg-muted hover:text-foreground ml-auto shrink-0 rounded p-1"
          >
            <FolderPlus className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {categories.map((cat) => {
            const items = grouped.byCat.get(cat.id) ?? [];
            const isCollapsed = collapsed[cat.id] ?? false;
            return (
              <div key={cat.id} className="mb-3">
                <div className="group flex items-center gap-0.5 px-1">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((prev) => ({ ...prev, [cat.id]: !isCollapsed }))
                    }
                    className="text-muted-foreground hover:text-foreground flex min-w-0 flex-1 items-center gap-0.5 py-1 text-left text-[11px] font-semibold tracking-wide uppercase"
                  >
                    <ChevronDown
                      className={cn(
                        "size-3 shrink-0 transition-transform",
                        isCollapsed && "-rotate-90",
                      )}
                    />
                    <span className="truncate">{cat.name}</span>
                  </button>
                  <button
                    type="button"
                    title={`Create channel in ${cat.name}`}
                    aria-label={`Create channel in ${cat.name}`}
                    onClick={() => {
                      setCollapsed((prev) => ({ ...prev, [cat.id]: false }));
                      openModal({
                        kind: "create-channel",
                        categoryId: cat.id,
                        categoryName: cat.name,
                      });
                    }}
                    className="text-muted-foreground hover:text-foreground rounded p-0.5 opacity-0 group-hover:opacity-100"
                  >
                    <Plus className="size-3.5" />
                  </button>
                  {cat.name !== DEFAULT_CATEGORY ? (
                    <button
                      type="button"
                      title={`Delete category ${cat.name}`}
                      aria-label={`Delete category ${cat.name}`}
                      onClick={() =>
                        openModal({
                          kind: "delete-category",
                          categoryId: cat.id,
                          categoryName: cat.name,
                        })
                      }
                      className="text-muted-foreground hover:text-destructive rounded p-0.5 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  ) : null}
                </div>

                {!isCollapsed ? (
                  <div className="mt-0.5 flex flex-col gap-0.5">
                    {items.map((channel) => {
                      const active = channel.id === activeChannelId;
                      return (
                        <div
                          key={channel.id}
                          className={cn(
                            "group/ch flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
                            active
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => switchChannel(channel.id)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                          >
                            <Hash className="size-4 shrink-0 opacity-70" />
                            <span className="truncate font-medium">{channel.name}</span>
                          </button>
                          {channel.name !== DEFAULT_CHANNEL ? (
                            <button
                              type="button"
                              title={`Delete #${channel.name}`}
                              aria-label={`Delete channel ${channel.name}`}
                              onClick={() =>
                                openModal({
                                  kind: "delete-channel",
                                  channelId: channel.id,
                                  channelName: channel.name,
                                })
                              }
                              className="text-muted-foreground hover:text-destructive hidden shrink-0 group-hover/ch:block"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}

          {grouped.uncategorized.length > 0 ? (
            <div className="mb-3">
              <p className="text-muted-foreground px-2 py-1 text-[11px] font-semibold tracking-wide uppercase">
                Uncategorized
              </p>
              {grouped.uncategorized.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => switchChannel(channel.id)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm",
                    channel.id === activeChannelId
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Hash className="size-4 shrink-0 opacity-70" />
                  <span className="truncate font-medium">{channel.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </nav>

      <Dialog
        open={modal?.kind === "create-category" || modal?.kind === "create-channel"}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {modal?.kind === "create-category" ? "New category" : "New channel"}
            </DialogTitle>
            <DialogDescription>
              {modal?.kind === "create-category"
                ? "Group related channels under a category."
                : modal?.kind === "create-channel"
                  ? `Create a channel in ${modal.categoryName}.`
                  : null}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-crud-name">
                {modal?.kind === "create-category" ? "Category name" : "Channel name"}
              </Label>
              <Input
                id="chat-crud-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  modal?.kind === "create-category" ? "Hardware" : "enclosure"
                }
                maxLength={40}
                required
              />
            </div>
            {error ? <p className="text-destructive text-[12px]">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={modal?.kind === "delete-channel" || modal?.kind === "delete-category"}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {modal?.kind === "delete-category" ? "Delete category" : "Delete channel"}
            </DialogTitle>
            <DialogDescription>
              {modal?.kind === "delete-category" ? (
                <>
                  Delete <span className="text-foreground font-medium">{modal.categoryName}</span>?
                  Channels in it move to Text Channels.
                </>
              ) : modal?.kind === "delete-channel" ? (
                <>
                  Delete{" "}
                  <span className="text-foreground font-medium">#{modal.channelName}</span>? This
                  removes the channel and its messages.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {error ? <p className="text-destructive text-[12px]">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeModal} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void submitDelete()}
              disabled={pending}
            >
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
