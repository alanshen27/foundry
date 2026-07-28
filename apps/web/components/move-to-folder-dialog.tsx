"use client";

import { useMemo, useState } from "react";
import { Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildFolderTree, folderSubtreeIds, type FolderRef } from "@/lib/workspace-folders";
import { cn } from "@/lib/utils";

export function MoveToFolderDialog({
  open,
  onOpenChange,
  folders,
  title,
  description,
  /** When moving a folder, exclude it and its descendants. */
  excludeFolderId,
  /** Current location (pre-select). */
  currentFolderId,
  pending,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: FolderRef[];
  title: string;
  description?: string;
  excludeFolderId?: string | null;
  currentFolderId?: string | null;
  pending?: boolean;
  onMove: (folderId: string | null) => void;
}) {
  const [selected, setSelected] = useState<string | null>(currentFolderId ?? null);

  const blocked = useMemo(
    () => (excludeFolderId ? folderSubtreeIds(folders, excludeFolderId) : new Set<string>()),
    [folders, excludeFolderId],
  );
  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setSelected(currentFolderId ?? null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="max-h-64 overflow-y-auto rounded-none border p-1">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={cn(
              "flex w-full items-center gap-2 rounded-none px-2.5 py-2 text-left text-[13px]",
              selected === null ? "bg-muted font-medium" : "hover:bg-muted/70",
            )}
          >
            <Folder className="size-3.5 opacity-70" strokeWidth={1.75} />
            Workspace root
          </button>
          <FolderPickList
            nodes={tree}
            depth={0}
            selected={selected}
            blocked={blocked}
            onSelect={setSelected}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || selected === (currentFolderId ?? null)}
            onClick={() => onMove(selected)}
          >
            {pending ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FolderPickList({
  nodes,
  depth,
  selected,
  blocked,
  onSelect,
}: {
  nodes: ReturnType<typeof buildFolderTree>;
  depth: number;
  selected: string | null;
  blocked: Set<string>;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (blocked.has(node.id)) return null;
        return (
          <div key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-none py-2 pr-2.5 text-left text-[13px]",
                selected === node.id ? "bg-muted font-medium" : "hover:bg-muted/70",
              )}
              style={{ paddingLeft: 10 + depth * 12 }}
            >
              <Folder className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
              <span className="truncate">{node.name}</span>
            </button>
            {node.children.length > 0 ? (
              <FolderPickList
                nodes={node.children}
                depth={depth + 1}
                selected={selected}
                blocked={blocked}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}
