import { redirect } from "next/navigation";
import { prisma } from "@foundry/db";
import { FoundryMark } from "@/components/foundry-mark";
import { getCurrentUser } from "@/server/session";
import { AcceptInviteButton } from "./accept-invite-button";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=/invite/${token}`);

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { workspace: true, project: true, invitedBy: true },
  });

  return (
    <main className="bg-dot-grid flex min-h-screen items-center justify-center p-6">
      <div className="border-border bg-card w-full max-w-md border text-center">
        <div className="border-border flex items-center justify-between border-b px-5 py-4 text-left">
          <FoundryMark />
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
            Invite
          </span>
        </div>
        <div className="px-5 py-6">
          {!invitation || invitation.status !== "PENDING" ? (
            <p className="text-muted-foreground text-sm">
              This invitation does not exist or has already been used.
            </p>
          ) : invitation.expiresAt < new Date() ? (
            <p className="text-muted-foreground text-sm">This invitation has expired.</p>
          ) : (
            <>
              <h1 className="mb-2 font-mono text-lg font-medium tracking-[-0.03em]">
                Join {invitation.workspace.name}
              </h1>
              <p className="text-muted-foreground mb-6 text-sm">
                {invitation.invitedBy.name} invited {invitation.email} as a workspace{" "}
                {invitation.role.toLowerCase()}
                {invitation.project ? (
                  <>
                    {" "}
                    (via <span className="text-foreground">{invitation.project.name}</span>)
                  </>
                ) : null}
                .
              </p>
              <AcceptInviteButton token={token} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
