import { cn } from "@/lib/utils";

/** Sidebar link; the selected one carries the accent so the sidebar has a focal point. */
export function navItemClass(active: boolean) {
  return cn(
    "group flex items-center gap-2.5 rounded-none px-2.5 py-[7px] text-[13px] transition-colors",
    active
      ? "bg-primary/10 text-primary font-medium"
      : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
  );
}

export function navIconClass(active: boolean) {
  return cn(
    "size-[15px] transition-opacity",
    active ? "opacity-100" : "opacity-70 group-hover:opacity-100",
  );
}
