import { cn } from "@/lib/utils";

/** Lavender F on a navy squircle + Foundyr wordmark. */
export function FoundryMark({
  className,
  showWord = true,
  size = "md",
}: {
  className?: string;
  showWord?: boolean;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "size-5" : "size-6";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <FoundyrMarkIcon className={box} />
      {showWord ? (
        <span className="text-foreground text-[13px] font-semibold tracking-[-0.01em]">
          Foundyr
        </span>
      ) : null}
    </span>
  );
}

export function FoundyrMarkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="32" height="32" rx="9" fill="#1C222E" />
      <g fill="#CAB7F7">
        <rect x="9.5" y="7" width="13.5" height="4" rx="1.7" />
        <rect x="9.5" y="14" width="10.5" height="4" rx="1.7" />
        <rect x="9.5" y="7" width="4.7" height="18" rx="1.7" />
      </g>
    </svg>
  );
}
