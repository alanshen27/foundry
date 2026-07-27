"use client";

import {
  FOLDER_COLORS,
  folderColorLabel,
  folderSwatchClass,
  type FolderColor,
} from "@/lib/folder-color";
import { cn } from "@/lib/utils";

/** Swatch grid for the bottom of a folder's actions menu. */
export function FolderColorPicker({
  selected,
  onSelect,
}: {
  selected: string | null | undefined;
  onSelect: (color: FolderColor | null) => void;
}) {
  return (
    <div className="mt-1 border-t px-2.5 pt-1.5 pb-1">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
          Color
        </span>
        {selected ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-[10px]"
            onClick={() => onSelect(null)}
          >
            Reset
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-5 gap-1">
        {FOLDER_COLORS.map((color) => {
          const active = selected === color;
          return (
            <button
              key={color}
              type="button"
              title={folderColorLabel(color)}
              aria-label={folderColorLabel(color)}
              aria-pressed={active}
              onClick={() => onSelect(color)}
              className={cn(
                "ring-offset-popover size-4 rounded-full transition-transform",
                folderSwatchClass(color),
                active ? "ring-foreground/60 ring-2 ring-offset-1" : "hover:scale-115",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
