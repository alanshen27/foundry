import { notFound, redirect } from "next/navigation";
import { prisma } from "@foundry/db";
import { Card } from "@/components/ui/card";
import { HomeShell } from "@/components/home-shell";
import { getCurrentUser } from "@/server/session";
import { InviteMemberForm } from "./invite-member-form";

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=/w/${workspaceSlug}/settings`);

  const [workspace, allMemberships] = await Promise.all([
    prisma.workspace.findFirst({
      where: { slug: workspaceSlug, memberships: { some: { userId: user.id } } },
      include: {
        memberships: { include: { user: true }, orderBy: { createdAt: "asc" } },
        invitations: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.workspaceMembership.findMany({
      where: { userId: user.id },
      include: { workspace: true },
      orderBy: { workspace: { name: "asc" } },
    }),
  ]);
  if (!workspace) notFound();

  const myRole = workspace.memberships.find((m) => m.userId === user.id)?.role;
  const canManage = myRole === "OWNER" || myRole === "ADMIN";

  return (
    <HomeShell
      workspaces={allMemberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
      }))}
      current={{ id: workspace.id, name: workspace.name, slug: workspace.slug }}
      userName={user.name}
    >
      <h1 className="mb-8 text-3xl font-semibold tracking-tight">Members</h1>

      <Card className="mb-6 p-4">
        <ul className="divide-y divide-border">
          {workspace.memberships.map((membership) => (
            <li key={membership.id} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm font-medium">{membership.user.name}</p>
                <p className="text-sm text-zinc-500">{membership.user.email}</p>
              </div>
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {membership.role}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {workspace.invitations.length > 0 ? (
        <Card className="mb-6 p-4">
          <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
            Pending invitations
          </h2>
          <ul className="divide-y divide-border">
            {workspace.invitations.map((invitation) => (
              <li key={invitation.id} className="py-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm">{invitation.email}</p>
                  <span className="text-xs uppercase tracking-wide text-zinc-500">
                    {invitation.role} · expires {invitation.expiresAt.toLocaleDateString()}
                  </span>
                </div>
                {/* Email delivery is not wired in Phase 0; share the link directly. */}
                <p className="mt-1 break-all text-xs text-zinc-500" data-testid="invite-link">
                  Invite link: /invite/{invitation.token}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {canManage ? (
        <InviteMemberForm workspaceId={workspace.id} actorRole={myRole!} />
      ) : (
        <p className="text-muted-foreground text-sm">Only owners and admins can invite members.</p>
      )}
    </HomeShell>
  );
}
