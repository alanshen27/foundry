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
    include: { workspace: true, invitedBy: true },
  });

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md p-6 text-center">
        {!invitation || invitation.status !== "PENDING" ? (
          <p className="text-sm text-zinc-400">
            This invitation does not exist or has already been used.
          </p>
        ) : invitation.expiresAt < new Date() ? (
          <p className="text-sm text-zinc-400">This invitation has expired.</p>
        ) : (
          <>
            <h1 className="mb-2 text-lg font-semibold">Join {invitation.workspace.name}</h1>
            <p className="mb-6 text-sm text-zinc-500">
              {invitation.invitedBy.name} invited {invitation.email} as {invitation.role}.
            </p>
            <AcceptInviteButton token={token} />
          </>
        )}
      </Card>
    </main>
  );
}
