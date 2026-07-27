import { redirect } from "next/navigation";
import { prisma } from "@foundry/db";
import { Card } from "@/components/ui/card";
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
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md p-6 text-center">
        {!invitation || invitation.status !== "PENDING" ? (
          <p className="text-muted-foreground text-sm">
            This invitation does not exist or has already been used.
          </p>
        ) : invitation.expiresAt < new Date() ? (
          <p className="text-muted-foreground text-sm">This invitation has expired.</p>
        ) : (
          <>
            <h1 className="mb-2 text-lg font-semibold">Join {invitation.workspace.name}</h1>
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
      </Card>
    </main>
  );
}
