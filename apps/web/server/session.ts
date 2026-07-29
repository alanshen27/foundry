import "server-only";
import { cache } from "react";
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
 * and maps it to our Postgres User row.
 *
 * Wrapped in React `cache()` so layouts + pages + tRPC context in one RSC
 * render share a single Auth + DB round-trip (critical on Render → Supabase).
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
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
  // Hot path: read + write only when email/avatar actually changed.
  return resolveSupabaseUser(identity);
});

/** True when avatarUrl points at a Foundry-hosted upload (must not be clobbered by OAuth). */
function isFoundryAvatarUrl(avatarUrl: string | null | undefined): boolean {
  return Boolean(avatarUrl?.startsWith("/api/files/users/"));
}

/**
 * Request-path resolve: avoid a Prisma UPDATE on every authenticated hit.
 * First-login create / email-adopt still goes through upsertSupabaseUser.
 */
export async function resolveSupabaseUser(identity: AuthenticatedIdentity): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { supabaseId: identity.subject } });
  if (!existing) return upsertSupabaseUser(identity);

  const nextEmail = identity.email;
  const nextAvatar = isFoundryAvatarUrl(existing.avatarUrl)
    ? existing.avatarUrl
    : (identity.avatarUrl ?? existing.avatarUrl ?? null);

  const emailChanged = existing.email !== nextEmail;
  const avatarChanged = (existing.avatarUrl ?? null) !== (nextAvatar ?? null);
  if (!emailChanged && !avatarChanged) return existing;

  return prisma.user.update({
    where: { id: existing.id },
    data: {
      ...(emailChanged ? { email: nextEmail } : {}),
      ...(avatarChanged ? { avatarUrl: nextAvatar } : {}),
    },
  });
}

/** Sign-in / confirm / OAuth callback — may create or adopt a user row. */
export async function upsertSupabaseUser(identity: AuthenticatedIdentity): Promise<User> {
  const bySupabaseId = await prisma.user.findUnique({ where: { supabaseId: identity.subject } });
  if (bySupabaseId) {
    const nextAvatar = isFoundryAvatarUrl(bySupabaseId.avatarUrl)
      ? bySupabaseId.avatarUrl
      : (identity.avatarUrl ?? bySupabaseId.avatarUrl ?? null);
    const emailChanged = bySupabaseId.email !== identity.email;
    const avatarChanged = (bySupabaseId.avatarUrl ?? null) !== (nextAvatar ?? null);
    if (!emailChanged && !avatarChanged) return bySupabaseId;
    return prisma.user.update({
      where: { id: bySupabaseId.id },
      data: {
        ...(emailChanged ? { email: identity.email } : {}),
        ...(avatarChanged ? { avatarUrl: nextAvatar } : {}),
      },
    });
  }

  // A row with this email may already exist (local-auth user, seed data, or a
  // re-created Supabase project). Adopt it instead of violating the email
  // unique constraint.
  const byEmail = await prisma.user.findUnique({ where: { email: identity.email } });
  if (byEmail) {
    const nextAvatar = isFoundryAvatarUrl(byEmail.avatarUrl)
      ? byEmail.avatarUrl
      : (identity.avatarUrl ?? byEmail.avatarUrl ?? null);
    return prisma.user.update({
      where: { id: byEmail.id },
      data: {
        supabaseId: identity.subject,
        ...((byEmail.avatarUrl ?? null) !== (nextAvatar ?? null) ? { avatarUrl: nextAvatar } : {}),
      },
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
