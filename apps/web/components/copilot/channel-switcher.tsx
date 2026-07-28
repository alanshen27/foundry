"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ChevronsUpDown, FolderPlus, Hash, Plus, Trash2 } from "lucide-react";
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

type Modal =
  | { kind: "create-category" }
  | { kind: "create-channel"; categoryId?: string }
  | { kind: "delete-channel"; channelId: string; channelName: string }
  | { kind: "delete-category"; categoryId: string; categoryName: string }
  | null;

/** Compact channel picker for the docked workspace chat (no Discord rail). */
export function ChannelSwitcher() {
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

  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const active = channels.find((c) => c.id === activeChannelId);

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

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function openModal(next: Modal) {
    setOpen(false);
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

  const defaultCategoryId = categories.find((c) => c.name === DEFAULT_CATEGORY)?.id;

  return (
    <>
      <div ref={ref} className="relative min-w-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="hover:bg-muted/60 flex h-7 max-w-48 items-center gap-1 rounded-none px-1.5 text-[13px] font-medium transition-colors"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <Hash className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate">{active?.name ?? "General"}</span>
          <ChevronsUpDown className="text-muted-foreground size-3 shrink-0" />
        </button>

        {open ? (
          <div
            role="listbox"
            className="bg-popover absolute top-full left-0 z-50 mt-1.5 w-64 overflow-hidden rounded-none border shadow-lg"
          >
            <div className="max-h-72 overflow-y-auto p-1">
              {categories.map((cat) => {
                const items = grouped.byCat.get(cat.id) ?? [];
                return (
                  <div key={cat.id} className="mb-1">
                    <div className="group flex items-center gap-1 px-2 py-1">
                      <span className="text-muted-foreground min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wide uppercase">
                        {cat.name}
                      </span>
                      {cat.name !== DEFAULT_CATEGORY ? (
                        <button
                          type="button"
                          title={`Delete ${cat.name}`}
                          aria-label={`Delete category ${cat.name}`}
                          onClick={() =>
                            openModal({
                              kind: "delete-category",
                              categoryId: cat.id,
                              categoryName: cat.name,
                            })
                          }
                          className="text-muted-foreground hover:text-destructive hidden shrink-0 group-hover:block"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      ) : null}
                    </div>
                    {items.map((channel) => (
                      <div
                        key={channel.id}
                        className={cn(
                          "group/ch hover:bg-muted flex items-center gap-2 rounded-none px-2 py-1.5 text-sm",
                          channel.id === activeChannelId && "bg-muted/60",
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => {
                            switchChannel(channel.id);
                            setOpen(false);
                          }}
                        >
                          <Hash className="text-muted-foreground size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{channel.name}</span>
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
                    ))}
                  </div>
                );
              })}

              {grouped.uncategorized.length > 0 ? (
                <div className="mb-1">
                  <p className="text-muted-foreground px-2 py-1 text-[11px] font-semibold tracking-wide uppercase">
                    Uncategorized
                  </p>
                  {grouped.uncategorized.map((channel) => (
                    <button
                      key={channel.id}
                      type="button"
                      className={cn(
                        "hover:bg-muted flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left text-sm",
                        channel.id === activeChannelId && "bg-muted/60",
                      )}
                      onClick={() => {
                        switchChannel(channel.id);
                        setOpen(false);
                      }}
                    >
                      <Hash className="text-muted-foreground size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => openModal({ kind: "create-channel", categoryId: defaultCategoryId })}
                className="text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-sm"
              >
                <Plus className="size-3.5" /> New channel
              </button>
              <button
                type="button"
                onClick={() => openModal({ kind: "create-category" })}
                className="text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-sm"
              >
                <FolderPlus className="size-3.5" /> New category
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <Dialog
        open={modal?.kind === "create-category" || modal?.kind === "create-channel"}
        onOpenChange={(next) => {
          if (!next) closeModal();
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
                : "Create a channel in this project."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="channel-switcher-name">
                {modal?.kind === "create-category" ? "Category name" : "Channel name"}
              </Label>
              <Input
                id="channel-switcher-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={modal?.kind === "create-category" ? "Hardware" : "enclosure"}
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
        onOpenChange={(next) => {
          if (!next) closeModal();
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
                  Delete <span className="text-foreground font-medium">#{modal.channelName}</span>?
                  This removes the channel and its messages.
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
