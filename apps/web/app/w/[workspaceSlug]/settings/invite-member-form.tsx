"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { assignableRoles, type WorkspaceRole } from "@foundry/domain";
import { trpc } from "@/lib/trpc";

export function InviteMemberForm({
  workspaceId,
  actorRole,
}: {
  workspaceId: string;
  actorRole: WorkspaceRole;
}) {
  const router = useRouter();
  const roles = assignableRoles(actorRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>(roles.includes("MEMBER") ? "MEMBER" : roles[0]!);
  const invite = trpc.workspace.inviteMember.useMutation({
    onSuccess: () => {
      setEmail("");
      router.refresh();
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (email.trim()) invite.mutate({ workspaceId, email: email.trim(), role });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide uppercase">
          Invite to workspace
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex gap-3">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            aria-label="Invitee email"
            required
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as WorkspaceRole)}
            aria-label="Role"
            className="border-input bg-transparent dark:bg-input/30 h-9 rounded-md border px-2 text-sm"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? "Inviting…" : "Invite"}
          </Button>
        </form>
        {invite.error ? (
          <p role="alert" className="text-destructive mt-2 text-sm">
            {invite.error.message}
          </p>
        ) : null}
        {invite.isSuccess ? (
          <p className="mt-2 text-sm text-emerald-400">
            Invitation created. Share the invite link shown above (email delivery arrives in a later
            phase).
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
