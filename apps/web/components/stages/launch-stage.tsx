"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { MediaLibrary } from "@/components/media/media-library";
import { trpc } from "@/lib/trpc";
import { formatCents } from "@/lib/format";

type Props = {
  projectId: string;
  branchId: string;
  canCreate: boolean;
  verifyApproved: boolean;
  /** site.edit — generate and delete marketing media. */
  canEditMedia: boolean;
  /** site.publish — approve media for storefront use. */
  canApproveMedia: boolean;
};

type SnapshotSummary = {
  requirements: number;
  components: number;
  repos: number;
  checks: number;
  checksPassed: number;
  checksWaived: number;
  bomCents: number;
};

export function LaunchStage({
  projectId,
  branchId,
  canCreate,
  verifyApproved,
  canEditMedia,
  canApproveMedia,
}: Props) {
  const router = useRouter();
  const list = trpc.launch.listReleases.useQuery({ projectId, branchId });
  const utils = trpc.useUtils();
  const create = trpc.launch.createRelease.useMutation({
    onSuccess: () => {
      router.refresh();
      void utils.launch.listReleases.invalidate({ projectId, branchId });
    },
  });

  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const releases = list.data ?? [];

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!version.trim()) return;
    create.mutate(
      { projectId, branchId, version: version.trim(), notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          setVersion("");
          setNotes("");
        },
      },
    );
  }

  function download(release: (typeof releases)[number]) {
    const blob = new Blob([JSON.stringify(release.snapshot, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `release-${release.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (list.isLoading) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading releases">
        <Card>
          <CardHeader className="gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-8 w-32" />
            </div>
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="gap-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-28" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-7 w-28" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Cut a release</CardTitle>
          <p className="text-muted-foreground text-sm">
            A release freezes an immutable snapshot of the brief, requirements, BOM, repositories,
            and validation results. Snapshots are never modified after creation.
          </p>
        </CardHeader>
        <CardContent>
          {!verifyApproved ? (
            <div className="border-border rounded-none border border-dashed p-4 text-sm">
              <p className="font-medium">Verification not approved</p>
              <p className="text-muted-foreground mt-1">
                Approve the Verify stage before creating a release.
              </p>
            </div>
          ) : canCreate ? (
            <form onSubmit={onCreate} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="Version (e.g. 1.0.0)"
                  className="w-48"
                  aria-label="Release version"
                />
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? "Creating…" : "Create release"}
                </Button>
              </div>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Release notes (optional)"
                rows={2}
                aria-label="Release notes"
              />
              {create.error ? (
                <p className="text-destructive text-sm">{create.error.message}</p>
              ) : null}
            </form>
          ) : (
            <p className="text-muted-foreground text-sm">
              You do not have permission to create releases.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Releases</CardTitle>
          <p className="text-muted-foreground text-sm">
            {releases.length} release{releases.length === 1 ? "" : "s"}.
          </p>
        </CardHeader>
        <CardContent>
          {releases.length === 0 ? (
            <EmptyState title="No releases yet">
              Approved projects can be released here to create a permanent, versioned record.
            </EmptyState>
          ) : (
            <ul className="divide-border divide-y">
              {releases.map((r) => {
                const summary = (r.snapshot as { summary?: SnapshotSummary })?.summary;
                const isOpen = expanded === r.id;
                return (
                  <li key={r.id} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <StatusBadge status="APPROVED" />
                        <span className="font-mono font-medium">v{r.version}</span>
                        <span className="text-muted-foreground text-sm">
                          by {r.createdByName} · {new Date(r.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpanded(isOpen ? null : r.id)}
                        >
                          {isOpen ? "Hide" : "Details"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => download(r)}>
                          Download JSON
                        </Button>
                      </div>
                    </div>
                    {r.notes ? (
                      <p className="text-muted-foreground mt-1 text-sm">{r.notes}</p>
                    ) : null}
                    {isOpen && summary ? (
                      <div className="text-muted-foreground mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                        <Stat label="Requirements" value={summary.requirements} />
                        <Stat label="Components" value={summary.components} />
                        <Stat label="Repos" value={summary.repos} />
                        <Stat
                          label="Checks passed"
                          value={`${summary.checksPassed}/${summary.checks}`}
                        />
                        <Stat label="Waived" value={summary.checksWaived} />
                        <Stat label="Est. BOM" value={formatCents(summary.bomCents)} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Marketing media</CardTitle>
          <p className="text-muted-foreground text-sm">
            Renders and product video for the storefront. These are marketing assets, not
            verification evidence — approving one only allows it on a site.
          </p>
        </CardHeader>
        <CardContent>
          <MediaLibrary projectId={projectId} canEdit={canEditMedia} canApprove={canApproveMedia} />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card size="sm" className="gap-0.5 p-2 py-2">
      <p className="text-xs uppercase">{label}</p>
      <p className="text-foreground text-base font-semibold">{value}</p>
    </Card>
  );
}
