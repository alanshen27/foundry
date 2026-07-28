import { cn } from "@/lib/utils";

/** Dot-matrix placeholder — soft pulsing grid instead of a flat grey bar. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton-dots rounded-none", className)}
      {...props}
    />
  );
}

export { Skeleton };
