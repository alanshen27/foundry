import { cn } from "@/lib/utils";

/**
 * Soft orange radial wash + dual-scale dots behind a create card.
 * Parent should be `relative`; this sits absolutely behind the white surface.
 */
export function SignalGlowBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute -inset-x-10 -inset-y-12 select-none", className)}
    >
      <div
        className="signal-glow-pulse absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 72% 58% at 50% 48%, color-mix(in srgb, var(--primary) 42%, transparent), color-mix(in srgb, var(--primary) 12%, transparent) 42%, transparent 72%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-80"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in srgb, var(--primary) 85%, white) 1.05px, transparent 1.2px)",
          backgroundSize: "9px 9px",
          maskImage: "radial-gradient(ellipse 68% 55% at 50% 48%, #000 10%, transparent 72%)",
          WebkitMaskImage: "radial-gradient(ellipse 68% 55% at 50% 48%, #000 10%, transparent 72%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-45"
        style={{
          backgroundImage: "radial-gradient(circle, var(--primary) 1.4px, transparent 1.55px)",
          backgroundSize: "18px 18px",
          backgroundPosition: "4px 4px",
          maskImage: "radial-gradient(ellipse 55% 45% at 50% 48%, #000 5%, transparent 65%)",
          WebkitMaskImage: "radial-gradient(ellipse 55% 45% at 50% 48%, #000 5%, transparent 65%)",
        }}
      />
    </div>
  );
}
