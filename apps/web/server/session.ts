import "server-only";
import { cookies } from "next/headers";
import { prisma, type User } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import {
  createSupabaseAuthAdapter,
  LOCAL_SESSION_COOKIE,
  verifySessionToken,
  type AuthenticatedIdentity,
} from "@foundry/auth";
import { createWorkspaceForOwner, defaultWorkspaceName } from "./create-workspace";

/**
 * Resolves the current request's identity through the configured AuthPort
 * and maps it to our Postgres User row (upserting on first Supabase login).
 */
export async function getCurrentUser(): Promise<User | null> {
  const env = getServerEnv();
  const cookieStore = await cookies();

  if (env.AUTH_MODE === "local") {
    const token = cookieStore.get(LOCAL_SESSION_COOKIE)?.value;
    if (!token || !env.AUTH_SECRET) return null;
    const payload = verifySessionToken(token, env.AUTH_SECRET);
    if (!payload) return null;
    return prisma.user.findUnique({ where: { id: payload.userId } });
  }

  const auth = createSupabaseAuthAdapter({
    url: env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    cookies: {
      getAll: () => cookieStore.getAll(),
      // Read-only in server components; sign-in route handlers set cookies.
      setAll: () => {},
    },
  });
  const identity = await auth.getIdentity();
  if (!identity) return null;
  return upsertSupabaseUser(identity);
}

export async function upsertSupabaseUser(identity: AuthenticatedIdentity): Promise<User> {
  const bySupabaseId = await prisma.user.findUnique({ where: { supabaseId: identity.subject } });
  if (bySupabaseId) {
    return prisma.user.update({
      where: { id: bySupabaseId.id },
      data: { email: identity.email, avatarUrl: identity.avatarUrl ?? undefined },
    });
  }

  // A row with this email may already exist (local-auth user, seed data, or a
  // re-created Supabase project). Adopt it instead of violating the email
  // unique constraint.
  const byEmail = await prisma.user.findUnique({ where: { email: identity.email } });
  if (byEmail) {
    return prisma.user.update({
      where: { id: byEmail.id },
      data: { supabaseId: identity.subject, avatarUrl: identity.avatarUrl ?? undefined },
    });
  }

  const user = await prisma.user.create({
    data: {
      supabaseId: identity.subject,
      email: identity.email,
      name: identity.name ?? identity.email.split("@")[0] ?? "User",
      avatarUrl: identity.avatarUrl,
    },
  });
  await createWorkspaceForOwner({
    userId: user.id,
    name: defaultWorkspaceName(user.name),
  });
  return user;
}
