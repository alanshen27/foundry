import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/workspaces");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-5xl font-bold tracking-tight">
        FOUNDRY
        <span className="ml-3 align-middle text-xs font-semibold uppercase tracking-widest text-orange-500">
          Phase 0
        </span>
      </h1>
      <p className="max-w-xl text-center text-lg text-zinc-400">
        Describe it. Engineer it. Build it. Sell it.
      </p>
      <p className="max-w-xl text-center text-sm text-zinc-500">
        This build contains the Phase 0 foundations: workspaces, projects, collaboration
        invitations, and the four-stage project shell. Engineering, verification, and launch
        surfaces are placeholders until their phases ship.
      </p>
      <Link
        href="/auth/sign-in"
        className="rounded-md bg-orange-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-500"
      >
        Sign in
      </Link>
    </main>
  );
}
