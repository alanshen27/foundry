"use client";

import { useState, type FormEvent } from "react";
import { Check, Copy, Link2, Mail, Share2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { selectClass } from "@/lib/format";

/**
 * Invite collaborators to the workspace. Can be opened from workspace home
 * or a project page — membership is always workspace-scoped; projectId is
 * only context for accept redirect / guest grants.
 */
export function ShareButton({
  workspaceId,
  workspaceName,
  projectId,
  projectName,
  variant = "share",
}: {
  workspaceId: string;
  workspaceName: string;
  projectId?: string;
  projectName?: string;
  variant?: "share" | "invite";
}) {
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const invite = trpc.workspace.inviteMember.useMutation({
    onSuccess: (invitation) => {
      setInviteLink(`${window.location.origin}/invite/${invitation.token}`);
      setEmail("");
    },
  });

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    invite.mutate({
      workspaceId,
      email: email.trim(),
      role: role as "ADMIN" | "MEMBER" | "GUEST",
      projectId,
    });
  }

  const triggerLabel = variant === "invite" ? "Invite" : "Share";
  const TriggerIcon = variant === "invite" ? UserPlus : Share2;

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button size="sm" className="gap-1.5">
            <TriggerIcon className="size-3.5" /> {triggerLabel}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to {workspaceName}</DialogTitle>
          <DialogDescription>
            Adds them as a workspace member
            {projectName ? (
              <>
                {" "}
                (they can open <span className="text-foreground">{projectName}</span>)
              </>
            ) : (
              <> with access to projects in this workspace</>
            )}
            .
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onInvite} className="flex items-center gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            aria-label="Invite email"
            className="flex-1"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={selectClass}
            aria-label="Workspace role"
          >
            <option value="ADMIN">Admin</option>
            <option value="MEMBER">Member</option>
            <option value="GUEST">Guest</option>
          </select>
          <Button type="submit" size="sm" disabled={invite.isPending || !email.trim()}>
            <Mail className="size-3.5" /> Invite
          </Button>
        </form>
        {invite.error ? <p className="text-destructive text-xs">{invite.error.message}</p> : null}
        {inviteLink ? (
          <div className="bg-muted/40 flex items-center gap-2 rounded-none border p-2">
            <Link2 className="text-muted-foreground size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-xs">{inviteLink}</span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => navigator.clipboard.writeText(inviteLink)}
            >
              Copy
            </Button>
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-muted-foreground text-xs">
            Workspace invite · share this page link anytime
          </span>
          <Button variant="outline" size="sm" onClick={copyLink}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
