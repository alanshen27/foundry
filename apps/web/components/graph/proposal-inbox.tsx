"use client";

/**
 * "Copilots draft and check, but ... stay behind explicit human approval."
 *
 * `link_nodes`, `add_tasks` and `add_risks` no longer write the graph
 * directly — each queues a GraphProposal, and this is the surface a human
 * approves or rejects one from. It lives next to the chat because a proposal
 * is copilot output: the natural place to close the loop on "I've proposed
 * X" is right where the copilot said it, not a context switch to the graph.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Check, GitBranch, ListChecks, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";

type Proposal = {
  id: string;
  kind: "LINK" | "TASK" | "RISK";
  payload: unknown;
  proposedByName: string | null;
  proposedAt: string | Date;
};

const KIND_ICON = { LINK: GitBranch, TASK: ListChecks, RISK: TriangleAlert } as const;

/** A human-readable one-liner for a proposal's payload, by kind. */
function summarize(p: Proposal): { title: string; detail?: string } {
  const payload = p.payload as Record<string, unknown>;
  if (p.kind === "LINK") {
    const from = payload.fromLabel ?? payload.from;
    const to = payload.toLabel ?? payload.to;
    return {
      title: `${String(from)} → ${String(to)} (${String(payload.kind).toLowerCase().replace(/_/g, " ")})`,
      detail: typeof payload.rationale === "string" ? payload.rationale : undefined,
    };
  }
  return {
    title: String(payload.title ?? "Untitled"),
    detail: typeof payload.detail === "string" ? payload.detail : undefined,
  };
}

function ProposalRow({
  projectId,
  branchId,
  proposal,
  onDecided,
}: {
  projectId: string;
  branchId: string;
  proposal: Proposal;
  onDecided: (notice?: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const approve = trpc.graph.approveProposal.useMutation({
    onSuccess: (result) =>
      onDecided(result.decided === "REJECTED" ? `Not applied: ${result.reason}` : undefined),
  });
  const reject = trpc.graph.rejectProposal.useMutation({ onSuccess: () => onDecided() });
  const busy = approve.isPending || reject.isPending;
  const { title, detail } = summarize(proposal);
  const Icon = KIND_ICON[proposal.kind];

  return (
    <li className="border-border/60 border-b px-4 py-3">
      <div className="flex items-start gap-2">
        <Icon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          {detail ? <p className="text-muted-foreground mt-0.5 text-xs">{detail}</p> : null}
          <p className="text-muted-foreground/70 mt-1 text-[11px]">
            Proposed by the copilot, acting for {proposal.proposedByName ?? "someone"}
          </p>
          {approve.error ? (
            <p className="text-destructive mt-1 text-xs">{approve.error.message}</p>
          ) : null}
          {reject.error ? (
            <p className="text-destructive mt-1 text-xs">{reject.error.message}</p>
          ) : null}
        </div>
      </div>

      {rejecting ? (
        <div className="mt-2 flex flex-col gap-1.5 pl-5.5">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why reject this?"
            className="border-input bg-background border px-2 py-1 text-xs"
            aria-label="Rejection reason"
            autoFocus
          />
          <div className="flex gap-1.5">
            <Button
              size="xs"
              variant="destructive"
              disabled={!reason.trim() || busy}
              onClick={() =>
                reject.mutate({
                  projectId,
                  branchId,
                  proposalId: proposal.id,
                  rationale: reason.trim(),
                })
              }
            >
              Confirm reject
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-1.5 pl-5.5">
          <Button
            size="xs"
            disabled={busy}
            onClick={() => approve.mutate({ projectId, branchId, proposalId: proposal.id })}
          >
            <Check className="size-3" aria-hidden /> Approve
          </Button>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      )}
    </li>
  );
}

export function ProposalInboxPanel({
  projectId,
  branchId,
  onClose,
}: {
  projectId: string;
  branchId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const list = trpc.graph.listProposals.useQuery(
    { projectId, branchId, status: "PENDING" },
    { refetchInterval: 5_000 },
  );
  const [notice, setNotice] = useState<string | null>(null);
  const onDecided = (message?: string) => {
    setNotice(message ?? null);
    void utils.graph.invalidate();
  };
  const proposals = (list.data ?? []) as Proposal[];

  return (
    <aside className="bg-background flex h-full w-full max-w-md flex-col border-l">
      <header className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="size-4 shrink-0 opacity-70" aria-hidden />
            Proposed changes
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Links, tasks and risks the copilot proposed. Nothing here takes effect until approved.
          </p>
        </div>
        <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close proposal inbox">
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {notice ? (
          <p className="border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
            {notice}
          </p>
        ) : null}
        {list.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : proposals.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">Nothing pending review.</p>
        ) : (
          <ul>
            {proposals.map((p) => (
              <ProposalRow
                key={p.id}
                projectId={projectId}
                branchId={branchId}
                proposal={p}
                onDecided={onDecided}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/** Bell + pending count, opened as a portalled overlay — chat sidebar header. */
export function ProposalInboxTrigger({
  projectId,
  branchId,
}: {
  projectId: string;
  branchId: string;
}) {
  const [open, setOpen] = useState(false);
  const count = trpc.graph.listProposals.useQuery(
    { projectId, branchId, status: "PENDING" },
    { refetchInterval: 10_000 },
  );
  const pending = count.data?.length ?? 0;

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setOpen(true)}
        className="relative"
        title="Proposed changes"
        aria-label={`Proposed changes${pending > 0 ? ` (${pending} pending)` : ""}`}
      >
        <Bell className="size-4" />
        {pending > 0 ? (
          <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full text-[9px] font-medium">
            {pending > 9 ? "9+" : pending}
          </span>
        ) : null}
      </Button>
      {open ? (
        <ProposalInboxOverlay
          projectId={projectId}
          branchId={branchId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** The inbox as a right-hand overlay — shared by the bell, Overview and Cmd+K. */
export function ProposalInboxOverlay({
  projectId,
  branchId,
  onClose,
}: {
  projectId: string;
  branchId: string;
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" role="dialog" aria-modal>
      <button
        type="button"
        className="flex-1 cursor-default"
        aria-label="Close proposal inbox"
        onClick={onClose}
      />
      <ProposalInboxPanel projectId={projectId} branchId={branchId} onClose={onClose} />
    </div>,
    document.body,
  );
}
