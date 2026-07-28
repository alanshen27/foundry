import Image from "next/image";
import { cn } from "@/lib/utils";

/** Pixel-dissolve D mark from /logo.png + mono wordmark. */
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
      <FoundryMarkIcon className={box} />
      {showWord ? (
        <span className="text-foreground font-mono text-[13px] font-medium tracking-[0.08em] uppercase">
          Foundry
        </span>
      ) : null}
    </span>
  );
}

export function FoundryMarkIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt=""
      width={128}
      height={128}
      className={cn("object-contain", className)}
      aria-hidden
    />
  );
}
