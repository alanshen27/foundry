"use client";

export function DesignCollaborationStatus({
  status,
  error,
}: {
  status: string;
  error?: string | null;
}) {
  if (status === "local" && !error) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className="pointer-events-none absolute bottom-2 left-2 z-40 max-w-md border bg-background/95 px-2 py-1 text-[10px] shadow-sm"
    >
      {error ??
        (status === "connected"
          ? "Live collaboration"
          : status === "disconnected"
            ? "Disconnected · editing paused"
            : "Connecting collaboration…")}
    </div>
  );
}
