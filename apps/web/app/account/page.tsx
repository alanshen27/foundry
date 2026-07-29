import { redirect } from "next/navigation";
import { prisma } from "@foundry/db";
import { HomeShell } from "@/components/home-shell";
import { SignalPageHeader } from "@/components/signal-page-header";
import { getCurrentUser } from "@/server/session";
import { ProfileForm } from "./profile-form";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=/account");

  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId: user.id },
    include: {
      workspace: {
        include: {
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
      },
    },
    orderBy: { workspace: { name: "asc" } },
  });

  const workspaces = memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
  }));
  const current = workspaces[0];
  const currentWorkspace = memberships[0]?.workspace;

  return (
    <HomeShell
      workspaces={workspaces}
      current={current}
      projects={currentWorkspace?.projects ?? []}
      folders={currentWorkspace?.folders ?? []}
      user={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }}
    >
      <SignalPageHeader
        code="Account"
        title="Profile"
        subtitle="Update how you appear across FOUNDRY"
        glyphSeed={`${user.id}-account`}
        className="mb-8"
      />
      <ProfileForm
        user={{
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
        }}
      />
    </HomeShell>
  );
}
