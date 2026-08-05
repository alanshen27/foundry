"use client";

/**
 * The "does it all fit together?" panel.
 *
 * Verification used to be a checklist somebody wrote by hand, which meant the
 * cross-stage failures — firmware driving an unwired pin, a part on the
 * schematic that never made it to the board — were only caught if a person
 * thought to write a check for them. This runs those comparisons, plus the
 * firmware against the schematic, and shows what happened.
 */

import { AlertTriangle, CheckCircle2, CircleAlert, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { findingKey, type FitFinding } from "@/lib/integration/fit-check";
import { trpc } from "@/lib/trpc";

const DOMAIN_LABEL: Record<string, string> = {
  ELECTRICAL: "Electrical",
  SOFTWARE: "Firmware",
  MECHANICAL: "Mechanical",
  CROSS_DOMAIN: "Cross-domain",
};

function FindingRow({ finding }: { finding: FitFinding }) {
  const Icon = finding.severity === "error" ? CircleAlert : AlertTriangle;
  return (
    <li className="flex items-start gap-2 py-1.5 text-sm">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          finding.severity === "error" ? "text-destructive" : "text-amber-500",
        )}
      />
      <div className="min-w-0">
        <p>
          <span className="text-muted-foreground mr-1.5 text-xs tracking-wide uppercase">
            {DOMAIN_LABEL[finding.domain] ?? finding.domain}
          </span>
          {finding.message}
        </p>
        {finding.hint ? <p className="text-muted-foreground text-xs">{finding.hint}</p> : null}
      </div>
    </li>
  );
}

export function FitCheckPanel({ projectId, branchId }: { projectId: string; branchId: string }) {
  // Manual: it runs a simulation, so it should be something you ask for rather
  // than something that happens every time the page mounts.
  const fit = trpc.verify.fitCheck.useQuery(
    { projectId, branchId },
    { enabled: false, staleTime: Infinity },
  );
  const report = fit.data;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            Integration fit check
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-500 uppercase">
              simulated
            </span>
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            Compares schematic, PCB, firmware, BOM and CAD, then runs the firmware against the
            schematic. Behavioural simulation — not compiled firmware on hardware.
          </p>
        </div>
        <Button variant="outline" onClick={() => void fit.refetch()} disabled={fit.isFetching}>
          {fit.isFetching ? (
            <RefreshCw className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {report ? "Re-run" : "Run check"}
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {fit.isFetching ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : fit.error ? (
          <p className="text-destructive text-sm">{fit.error.message}</p>
        ) : !report ? (
          <p className="text-muted-foreground text-sm">
            Not run yet for this revision of the project.
          </p>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm">
              {report.ok ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : (
                <CircleAlert className="text-destructive size-4" />
              )}
              {report.ok
                ? "The stages agree with each other."
                : `${report.counts.errors} problem${report.counts.errors === 1 ? "" : "s"} to fix`}
              {report.counts.warnings > 0 ? (
                <span className="text-muted-foreground">
                  · {report.counts.warnings} warning{report.counts.warnings === 1 ? "" : "s"}
                </span>
              ) : null}
            </p>

            {report.simulation.ran ? (
              <div className="bg-muted/40 rounded-md border p-3 text-sm">
                <p className="font-medium">
                  Ran {report.simulation.firmwarePath} on {report.simulation.mcuLabel} for{" "}
                  {report.simulation.virtualMs / 1000}s of program time
                </p>
                <p className="text-muted-foreground text-xs">
                  Pins used:{" "}
                  {report.simulation.pinsExercised.length > 0
                    ? report.simulation.pinsExercised.join(", ")
                    : "none"}
                </p>
                {report.simulation.actuators.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {report.simulation.actuators.map((a) => (
                      <li
                        key={a.partId}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs",
                          a.activated
                            ? "border-emerald-500/40 text-emerald-500"
                            : "text-muted-foreground",
                        )}
                      >
                        {a.label} {a.activated ? "activated" : "never activated"}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {report.simulation.logs.length > 0 ? (
                  <pre className="text-muted-foreground mt-2 max-h-32 overflow-auto font-mono text-[11px] whitespace-pre-wrap">
                    {report.simulation.logs.join("\n")}
                  </pre>
                ) : null}
              </div>
            ) : (
              <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                Firmware was not run: {report.simulation.reason}
              </p>
            )}

            {report.findings.length > 0 ? (
              <ul className="divide-y">
                {report.findings.map((finding, i) => (
                  <FindingRow key={findingKey(finding, i)} finding={finding} />
                ))}
              </ul>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
