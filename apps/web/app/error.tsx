"use client";

/**
 * Catches a crash in any page below the root layout.
 *
 * Next's default is a bare "Application error" with nothing recorded. This
 * keeps the FOUNDRY chrome, offers a retry, shows the digest so a report can
 * be matched to the server log, and sends the error to /api/client-errors.
 */

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/report-client-error";

export default function SegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, "segment");
  }, [error]);

  return (
    <main className="bg-background flex min-h-[60vh] items-center justify-center px-4 py-16">
      <div className="bg-card w-full max-w-md border p-6">
        <p className="text-muted-foreground flex items-center gap-2 font-mono text-[11px] tracking-[0.1em] uppercase">
          <AlertTriangle className="text-destructive size-3.5" aria-hidden />
          Something broke
        </p>
        <h1 className="mt-3 text-lg font-semibold">This view failed to load.</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The error has been recorded. Your saved work is unaffected — retrying usually gets you
          back.
        </p>
        {error.digest ? (
          <p className="text-muted-foreground mt-4 font-mono text-xs">ref {error.digest}</p>
        ) : null}
        <div className="mt-5 flex gap-2">
          <Button onClick={reset}>
            <RotateCcw className="size-4" aria-hidden />
            Try again
          </Button>
          <Button variant="outline" onClick={() => window.location.assign("/")}>
            Go home
          </Button>
        </div>
      </div>
    </main>
  );
}
