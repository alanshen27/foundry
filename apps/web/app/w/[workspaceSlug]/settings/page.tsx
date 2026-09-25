import { notFound, redirect } from "next/navigation";
import { prisma } from "@foundry/db";
import { Card } from "@/components/ui/card";
import { HomeShell } from "@/components/home-shell";
import { SignalPageHeader } from "@/components/signal-page-header";
import { ThemeSettingsPanel } from "@/components/theme-picker";
import { UserAvatar } from "@/components/user-avatar";
import { getCurrentUser } from "@/server/session";
import { workspaceUsage } from "@/server/ai-usage";
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
        invitations: {
          where: { status: "PENDING" },
          include: { project: true },
          orderBy: { createdAt: "desc" },
        },
        projects: {
          where: { status: "ACTIVE" },
          select: { id: true, name: true, slug: true, folderId: true },
          orderBy: { createdAt: "asc" },
        },
        folders: {
          select: { id: true, name: true, parentId: true, sortOrder: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
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
  const usage = await workspaceUsage(workspace.id);
  const budgetShare = usage.budget !== null ? Math.min(1, usage.totalTokens / usage.budget) : null;

  return (
    <HomeShell
      workspaces={allMemberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
      }))}
      current={{ id: workspace.id, name: workspace.name, slug: workspace.slug }}
      projects={workspace.projects}
      folders={workspace.folders}
      user={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }}
    >
      <SignalPageHeader
        code="Workspace"
        title="Settings"
        subtitle={`Appearance and workspace members for ${workspace.name}`}
        glyphSeed={`${workspace.id}-settings`}
        className="mb-8"
      />

      <section className="mb-10">
        <h2 className="text-muted-foreground mb-3 font-mono text-[11px] font-medium tracking-[0.1em] uppercase">
          Copilot usage · last {usage.windowHours}h
        </h2>
        <Card className="gap-3 rounded-none p-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <p className="text-2xl font-semibold tabular-nums">
              {usage.totalTokens.toLocaleString("en-US")}
              <span className="text-muted-foreground ml-1.5 text-sm font-normal">tokens</span>
            </p>
            <p className="text-muted-foreground text-sm tabular-nums">
              {usage.runs} run{usage.runs === 1 ? "" : "s"}
            </p>
          </div>
          {usage.budget !== null && budgetShare !== null ? (
            <div className="flex flex-col gap-1.5">
              <div
                className="bg-muted h-1.5 w-full overflow-hidden"
                role="meter"
                aria-label="Share of daily copilot budget used"
                aria-valuemin={0}
                aria-valuemax={usage.budget}
                aria-valuenow={usage.totalTokens}
              >
                <div
                  className={budgetShare >= 1 ? "bg-destructive h-full" : "bg-primary h-full"}
                  style={{ width: `${Math.round(budgetShare * 100)}%` }}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                {budgetShare >= 1
                  ? "Budget reached — new copilot runs are paused until older runs age out of the window."
                  : `${Math.round(budgetShare * 100)}% of the ${usage.budget.toLocaleString("en-US")}-token daily budget.`}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              No daily budget is set, so usage is recorded but not capped. Set
              AI_WORKSPACE_DAILY_TOKEN_BUDGET to cap it.
            </p>
          )}
        </Card>
      </section>

      <section className="mb-10">
        <h2 className="text-muted-foreground mb-3 font-mono text-[11px] font-medium tracking-[0.1em] uppercase">
          Theme
        </h2>
        <Card className="gap-0 rounded-none p-4">
          <ThemeSettingsPanel />
        </Card>
      </section>

      <section className="mb-6">
        <h2 className="text-muted-foreground mb-3 font-mono text-[11px] font-medium tracking-[0.1em] uppercase">
          Members
        </h2>
        <Card className="mb-6 gap-0 rounded-none p-0">
          <ul className="divide-border divide-y">
            {workspace.memberships.map((membership) => (
              <li
                key={membership.id}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <UserAvatar
                    userId={membership.user.id}
                    name={membership.user.name}
                    avatarUrl={membership.user.avatarUrl}
                    className="size-8"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{membership.user.name}</p>
                    <p className="text-muted-foreground truncate text-[12px]">
                      {membership.user.email}
                    </p>
                  </div>
                </div>
                <span className="text-muted-foreground shrink-0 font-mono text-[11px] font-medium tracking-wide uppercase">
                  {membership.role}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        {workspace.invitations.length > 0 ? (
          <Card className="mb-6 gap-0 rounded-none p-0">
            <div className="border-b px-3.5 py-2.5">
              <h2 className="text-muted-foreground font-mono text-[11px] font-medium tracking-[0.1em] uppercase">
                Pending invitations
              </h2>
            </div>
            <ul className="divide-border divide-y">
              {workspace.invitations.map((invitation) => (
                <li key={invitation.id} className="px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px]">{invitation.email}</p>
                      {invitation.project ? (
                        <p className="text-muted-foreground truncate text-[11px]">
                          Via project {invitation.project.name}
                        </p>
                      ) : null}
                    </div>
                    <span className="text-muted-foreground shrink-0 text-[11px] tracking-wide uppercase">
                      {invitation.role} · expires {invitation.expiresAt.toLocaleDateString()}
                    </span>
                  </div>
                  {/* Email delivery is not wired in Phase 0; share the link directly. */}
                  <p
                    className="text-muted-foreground mt-1 break-all text-[11px]"
                    data-testid="invite-link"
                  >
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
          <p className="text-muted-foreground text-sm">
            Only owners and admins can invite members.
          </p>
        )}
      </section>
    </HomeShell>
  );
}
